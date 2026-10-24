import type { Review, Verdict } from './schema.js';

export interface VerdictDecision {
  verdict: Verdict;
  reasons: string[];
}

/**
 * The verdict policy, enforced in code regardless of what the model says:
 * - any criterion "fail" or any "critical" finding    -> DECLINED
 * - otherwise any criterion "warn" or "major" finding -> NEEDS_WORK
 * - otherwise                                         -> APPROVED ("minor" findings are allowed)
 */
export function computeVerdict(review: Pick<Review, 'criteria' | 'findings'>): VerdictDecision {
  const failed = review.criteria.filter((c) => c.status === 'fail').map((c) => c.id);
  const warned = review.criteria.filter((c) => c.status === 'warn').map((c) => c.id);
  const critical = review.findings.filter((f) => f.severity === 'critical').length;
  const major = review.findings.filter((f) => f.severity === 'major').length;

  if (failed.length > 0 || critical > 0) {
    const reasons: string[] = [];
    if (failed.length > 0) reasons.push(`failed criteria: ${failed.join(', ')}`);
    if (critical > 0) reasons.push(`${critical} critical finding(s)`);
    return { verdict: 'DECLINED', reasons };
  }
  if (warned.length > 0 || major > 0) {
    const reasons: string[] = [];
    if (warned.length > 0) reasons.push(`criteria with warnings: ${warned.join(', ')}`);
    if (major > 0) reasons.push(`${major} major finding(s)`);
    return { verdict: 'NEEDS_WORK', reasons };
  }
  return { verdict: 'APPROVED', reasons: ['all criteria pass and no critical/major findings'] };
}

export interface ReconciledVerdict extends VerdictDecision {
  modelVerdict: Verdict;
  overridden: boolean;
}

export function reconcileVerdict(review: Review): ReconciledVerdict {
  const decision = computeVerdict(review);
  return {
    ...decision,
    modelVerdict: review.verdict,
    overridden: decision.verdict !== review.verdict,
  };
}
