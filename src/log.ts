import { formatCost } from './pricing.js';
import type { Logger, ReviewOutcome } from './review.js';

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

const COST_SOURCE = {
  provider: 'reported by OpenRouter',
  config: 'tokens x rates from config/pricing.json',
  unknown: 'model not in config/pricing.json',
} as const;

/** Logs run metrics. Never logs the diff, the prompt, the response or any secret. */
export function logOutcome(outcome: ReviewOutcome, maxDiffChars: number, logger: Logger): void {
  const { stats, usage } = outcome;
  logger.info(`Model: ${outcome.model} (provider ${outcome.provider})`);
  logger.info(
    `Files: ${stats.totalFiles} changed, ${stats.filteredFiles} filtered as noise, ${stats.reviewedFiles} reviewed, ${stats.omittedFiles} omitted`,
  );
  logger.info(
    `Diff size: ${stats.diffChars} chars reviewable, ${stats.sentDiffChars} chars sent (limit ${maxDiffChars})`,
  );
  logger.info(
    `Time: model ${seconds(outcome.llmDurationMs)} over ${outcome.llmCalls} step(s), total ${seconds(outcome.durationMs)}`,
  );
  logger.info(
    `Tokens: input ${usage.inputTokens} (cached ${usage.cachedInputTokens}), output ${usage.outputTokens} (reasoning ${usage.reasoningTokens})`,
  );
  logger.info(`Cost: ${formatCost(outcome.cost)} (${COST_SOURCE[outcome.cost.source]})`);
  logger.info(
    `Verdict: ${outcome.decision.verdict}${outcome.decision.overridden ? ` (model said ${outcome.decision.modelVerdict})` : ''} - ${outcome.decision.reasons.join('; ')}`,
  );
}
