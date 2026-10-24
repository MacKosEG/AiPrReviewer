import { describe, expect, it } from 'vitest';
import { shouldFail, type FailOn } from '../src/exit.js';
import type { Review, Severity, Verdict } from '../src/schema.js';
import { computeVerdict, reconcileVerdict } from '../src/verdict.js';

function review(
  statuses: ('pass' | 'warn' | 'fail')[],
  severities: Severity[] = [],
  verdict: Verdict = 'APPROVED',
): Review {
  return {
    verdict,
    summary: 's',
    criteria: statuses.map((status, i) => ({ id: `c${i}`, name: `C${i}`, status, comment: '' })),
    findings: severities.map((severity) => ({
      file: 'a.ts',
      line: 1,
      severity,
      message: 'm',
      suggestion: undefined,
    })),
  };
}

describe('computeVerdict', () => {
  it.each<[string, Review, Verdict]>([
    ['all pass, no findings', review(['pass', 'pass']), 'APPROVED'],
    ['all pass, minor findings only', review(['pass'], ['minor', 'minor']), 'APPROVED'],
    ['a warn', review(['pass', 'warn']), 'NEEDS_WORK'],
    ['a major finding', review(['pass'], ['major']), 'NEEDS_WORK'],
    ['a fail', review(['pass', 'fail']), 'DECLINED'],
    ['a critical finding with all pass', review(['pass'], ['critical']), 'DECLINED'],
    ['fail beats warn', review(['warn', 'fail'], ['major']), 'DECLINED'],
  ])('%s -> %s', (_name, r, expected) => {
    expect(computeVerdict(r).verdict).toBe(expected);
  });

  it('explains the reasons', () => {
    expect(computeVerdict(review(['fail', 'pass'], ['critical'])).reasons).toEqual([
      'failed criteria: c0',
      '1 critical finding(s)',
    ]);
  });
});

describe('reconcileVerdict', () => {
  it('keeps a consistent model verdict', () => {
    expect(reconcileVerdict(review(['warn'], [], 'NEEDS_WORK'))).toMatchObject({
      verdict: 'NEEDS_WORK',
      modelVerdict: 'NEEDS_WORK',
      overridden: false,
    });
  });

  it('overrides a model that approves despite a failing criterion', () => {
    expect(reconcileVerdict(review(['fail'], [], 'APPROVED'))).toMatchObject({
      verdict: 'DECLINED',
      modelVerdict: 'APPROVED',
      overridden: true,
    });
  });

  it('overrides a model that is stricter than the policy', () => {
    expect(reconcileVerdict(review(['pass'], ['minor'], 'DECLINED'))).toMatchObject({
      verdict: 'APPROVED',
      overridden: true,
    });
  });
});

describe('shouldFail', () => {
  it.each<[Verdict, FailOn, boolean]>([
    ['APPROVED', 'DECLINED', false],
    ['NEEDS_WORK', 'DECLINED', false],
    ['DECLINED', 'DECLINED', true],
    ['APPROVED', 'NEEDS_WORK', false],
    ['NEEDS_WORK', 'NEEDS_WORK', true],
    ['DECLINED', 'NEEDS_WORK', true],
    ['APPROVED', 'never', false],
    ['NEEDS_WORK', 'never', false],
    ['DECLINED', 'never', false],
  ])('%s with fail-on=%s -> %s', (verdict, failOn, expected) => {
    expect(shouldFail(verdict, failOn)).toBe(expected);
  });
});
