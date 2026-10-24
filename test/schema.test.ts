import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadDefaultCriteria } from '../src/criteria.js';
import { buildReviewSchema, normalizeReview } from '../src/schema.js';
import { reviewJson } from './helpers.js';

const criteria = loadDefaultCriteria();
const schema = buildReviewSchema(criteria);
const parse = (text: string) => schema.safeParse(JSON.parse(text));

describe('buildReviewSchema', () => {
  it('pins criteria ids and count in the JSON Schema sent to the model', () => {
    const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as unknown as {
      properties: {
        criteria: {
          minItems: number;
          maxItems: number;
          items: { properties: { id: { enum: string[] } } };
        };
      };
      required: string[];
    };
    expect(json.properties.criteria.minItems).toBe(6);
    expect(json.properties.criteria.maxItems).toBe(6);
    expect(json.properties.criteria.items.properties.id.enum).toEqual(criteria.map((c) => c.id));
    expect(json.required).toEqual(['verdict', 'summary', 'criteria', 'findings']);
  });

  it('accepts a valid review with optional finding fields omitted', () => {
    const result = parse(
      reviewJson(criteria, {
        findings: [
          { file: 'b.ts', severity: 'major', message: 'm' },
          { file: 'c.ts', line: 12, severity: 'critical', message: 'm', suggestion: 'fix' },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects wrong enum values', () => {
    expect(parse(reviewJson(criteria, { verdict: 'LGTM' })).success).toBe(false);
    expect(
      parse(reviewJson(criteria, { findings: [{ file: 'a', severity: 'blocker', message: 'x' }] }))
        .success,
    ).toBe(false);
  });

  it('rejects unknown, missing and duplicate criteria', () => {
    const unknown = JSON.parse(reviewJson(criteria));
    unknown.criteria[0].id = 'vibes';
    expect(schema.safeParse(unknown).success).toBe(false);

    const missing = JSON.parse(reviewJson(criteria));
    missing.criteria.pop();
    expect(schema.safeParse(missing).success).toBe(false);

    const duplicate = JSON.parse(reviewJson(criteria));
    duplicate.criteria[1] = { ...duplicate.criteria[0] };
    const result = schema.safeParse(duplicate);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        'duplicate entry for criterion "correctness"',
      );
    }
  });
});

describe('normalizeReview', () => {
  it('orders criteria as configured, uses configured names and drops empty suggestions', () => {
    const raw = JSON.parse(
      reviewJson(criteria, {
        findings: [{ file: 'a.ts', severity: 'minor', message: 'm', suggestion: '  ' }],
      }),
    );
    raw.criteria.reverse();
    raw.criteria[0].name = 'whatever the model said';
    const review = normalizeReview(schema.parse(raw), criteria);
    expect(review.criteria.map((c) => c.id)).toEqual(criteria.map((c) => c.id));
    expect(review.criteria.map((c) => c.name)).toEqual(criteria.map((c) => c.name));
    expect(review.findings[0]?.suggestion).toBeUndefined();
  });
});
