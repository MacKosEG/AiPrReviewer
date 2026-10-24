import { describe, expect, it } from 'vitest';
import { loadDefaultCriteria, parseCriteria, resolveCriteria, slugify } from '../src/criteria.js';
import { fixture } from './helpers.js';

describe('default criteria (config/default-criteria.md)', () => {
  it('ships exactly 6 criteria with stable ids and a full rubric each', () => {
    const criteria = loadDefaultCriteria();
    expect(criteria.map((c) => c.id)).toEqual([
      'correctness',
      'security',
      'tests',
      'error-handling',
      'maintainability',
      'performance',
    ]);
    for (const c of criteria) {
      expect(c.description).not.toBe('');
      expect(Object.keys(c.rubric ?? {}).sort()).toEqual(['fail', 'pass', 'warn']);
    }
    expect(criteria[1]?.rubric?.fail).toContain('injection');
  });
});

describe('parseCriteria', () => {
  it('parses ## headings into criteria with slug ids', () => {
    const criteria = parseCriteria(fixture('criteria.md'));
    expect(criteria.map((c) => c.id)).toEqual([
      'correctness',
      'security',
      'tests',
      'error-handling',
      'code-quality',
    ]);
    expect(criteria[1]?.description).toContain('parameterized');
    expect(criteria[0]?.rubric).toBeUndefined();
  });

  it('extracts rubric bullets and explicit ids', () => {
    const md = [
      '## API design {#api}',
      'REST conventions.',
      '- **pass**: consistent resources',
      '* warn – inconsistent naming',
      '- **Fail**: breaking change without versioning',
      '- other bullet stays in the description',
    ].join('\n');
    const [c] = parseCriteria(md);
    expect(c).toEqual({
      id: 'api',
      name: 'API design',
      description: 'REST conventions.\n- other bullet stays in the description',
      rubric: {
        pass: 'consistent resources',
        warn: 'inconsistent naming',
        fail: 'breaking change without versioning',
      },
    });
  });

  it('ignores intro text and ### subheadings, dedupes ids', () => {
    const md = 'Intro\n## API design\nUse REST.\n### detail\nmore\n## API Design!\nAgain';
    const criteria = parseCriteria(md);
    expect(criteria.map((c) => c.id)).toEqual(['api-design', 'api-design-2']);
    expect(criteria[0]?.description).toBe('Use REST.\n### detail\nmore');
  });

  it('rejects files without headings', () => {
    expect(() => parseCriteria('just text')).toThrow(/no "## <name>" headings/);
  });

  it('rejects more than 20 criteria', () => {
    const md = Array.from({ length: 21 }, (_, i) => `## C${i}`).join('\n');
    expect(() => parseCriteria(md)).toThrow(/maximum is 20/);
  });

  it('slugifies diacritics and punctuation', () => {
    expect(slugify('Bezpieczeństwo & Uprawnienia')).toBe('bezpieczenstwo-uprawnienia');
    expect(slugify('!!!')).toBe('criterion');
  });
});

describe('resolveCriteria', () => {
  it('uses the defaults when the consumer file is missing', () => {
    expect(resolveCriteria(undefined)).toEqual({
      criteria: loadDefaultCriteria(),
      source: 'default',
    });
  });

  it('replaces the defaults completely with the consumer file', () => {
    const { criteria, source } = resolveCriteria('## Only this');
    expect(source).toBe('file');
    expect(criteria.map((c) => c.id)).toEqual(['only-this']);
  });
});
