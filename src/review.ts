import type { ModelSelection, ProviderName } from './agent/model.js';
import {
  createReviewerAgent,
  InvalidReviewOutputError,
  runReviewerAgent,
  ZERO_USAGE,
  type TokenUsage,
} from './agent/reviewer.js';
import { applyBudget } from './diff/budget.js';
import { filterNoise, type NoiseReason } from './diff/filter.js';
import { computeCost, type CostEstimate } from './pricing.js';
import { buildRetryPrompt, buildUserPrompt, SYSTEM_PROMPT } from './prompt.js';
import { buildReviewSchema, normalizeReview, type Review, type ReviewSchema } from './schema.js';
import type { ContextFile, Criterion, FileDiff } from './types.js';
import { reconcileVerdict, type ReconciledVerdict } from './verdict.js';

export interface Logger {
  info(message: string): void;
  warning(message: string): void;
}

export const silentLogger: Logger = { info: () => {}, warning: () => {} };

export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewError';
  }
}

export interface ReviewInput {
  files: FileDiff[];
  criteria: Criterion[];
  context: ContextFile[];
  pr?: { title?: string; body?: string };
  maxDiffChars: number;
}

export interface ReviewDeps {
  model: ModelSelection;
  logger?: Logger;
  now?: () => Date;
  timeoutMs?: number;
}

export interface ReviewStats {
  totalFiles: number;
  filteredFiles: number;
  reviewedFiles: number;
  omittedFiles: number;
  /** Size of the formatted diff of all reviewable files. */
  diffChars: number;
  /** Characters actually sent to the model. */
  sentDiffChars: number;
}

export interface ReviewOutcome {
  /** Review with the verdict already replaced by the policy verdict. */
  review: Review;
  decision: ReconciledVerdict;
  model: string;
  provider: ProviderName;
  usage: TokenUsage;
  cost: CostEstimate;
  /** Model calls (agent steps) across attempts. */
  llmCalls: number;
  llmDurationMs: number;
  durationMs: number;
  stats: ReviewStats;
  filtered: { path: string; reason: NoiseReason }[];
  /** Human-readable list of what was not reviewed (partial review). */
  omissions: string[];
  /** True when the model was not called because there was nothing to review. */
  skipped: boolean;
}

function syntheticReview(
  criteria: Criterion[],
  status: 'pass' | 'warn',
  summary: string,
  comment: string,
): Review {
  return {
    verdict: status === 'pass' ? 'APPROVED' : 'NEEDS_WORK',
    summary,
    criteria: criteria.map((c) => ({ id: c.id, name: c.name, status, comment })),
    findings: [],
  };
}

export interface PreparedReview {
  system: string;
  user: string;
  schema: ReviewSchema;
  /** False when there is nothing the model could review. */
  hasReviewableFiles: boolean;
  stats: ReviewStats;
  filtered: { path: string; reason: NoiseReason }[];
  omissions: string[];
  missingPatch: string[];
}

/** Filters and budgets the diff and builds the prompt, without calling the model. */
export function prepareReview(input: ReviewInput): PreparedReview {
  const filter = filterNoise(input.files);
  const budget = applyBudget(filter.kept, input.maxDiffChars);

  const omissions: string[] = [];
  if (filter.missingPatch.length > 0) {
    omissions.push(
      `${filter.missingPatch.length} file(s) have no diff available from GitHub (too large): ${filter.missingPatch.join(', ')}`,
    );
  }
  if (budget.truncatedFile) {
    omissions.push(`the diff of ${budget.truncatedFile} was truncated to fit the size limit`);
  }
  if (budget.omittedFiles.length > 0) {
    omissions.push(
      `${budget.omittedFiles.length} file(s) omitted because the diff exceeds max-diff-chars (${input.maxDiffChars}): ${budget.omittedFiles.join(', ')}`,
    );
  }

  const stats: ReviewStats = {
    totalFiles: input.files.length,
    filteredFiles: filter.filtered.length,
    reviewedFiles: budget.includedFiles.length,
    omittedFiles: budget.omittedFiles.length + filter.missingPatch.length,
    diffChars: budget.totalChars,
    sentDiffChars: budget.text.length,
  };
  return {
    system: SYSTEM_PROMPT,
    user: buildUserPrompt({
      criteria: input.criteria,
      diffText: budget.text,
      context: input.context,
      omissions,
      ...(input.pr ? { pr: input.pr } : {}),
    }),
    schema: buildReviewSchema(input.criteria),
    hasReviewableFiles: filter.kept.length > 0,
    stats,
    filtered: filter.filtered,
    omissions,
    missingPatch: filter.missingPatch,
  };
}

export async function runReview(input: ReviewInput, deps: ReviewDeps): Promise<ReviewOutcome> {
  const started = Date.now();
  const logger = deps.logger ?? silentLogger;
  const { model } = deps;

  const prepared = prepareReview(input);
  const base = {
    model: model.modelId,
    provider: model.provider,
    stats: prepared.stats,
    filtered: prepared.filtered,
    omissions: prepared.omissions,
  };

  if (!prepared.hasReviewableFiles) {
    const review =
      prepared.missingPatch.length === 0
        ? syntheticReview(
            input.criteria,
            'pass',
            'No reviewable code changes: the PR only touches files that are filtered as noise (lockfiles, generated files, binaries, snapshots).',
            'No reviewable code changes.',
          )
        : syntheticReview(
            input.criteria,
            'warn',
            'The changed files could not be reviewed because GitHub did not return their diff (too large). Review them manually.',
            'Not reviewed: diff not available.',
          );
    const decision = reconcileVerdict(review);
    logger.info('No reviewable changes; skipping the model call.');
    return {
      ...base,
      review: { ...review, verdict: decision.verdict },
      decision,
      usage: ZERO_USAGE,
      cost: { usd: 0, source: 'config' },
      llmCalls: 0,
      llmDurationMs: 0,
      durationMs: Date.now() - started,
      skipped: true,
    };
  }

  const agent = createReviewerAgent({
    model: model.model,
    instructions: prepared.system,
    schema: prepared.schema,
  });

  let run;
  try {
    run = await runReviewerAgent(agent, prepared.user, {
      retryPrompt: buildRetryPrompt,
      onInvalidOutput: (error, attempt) =>
        logger.warning(`Model output failed schema validation (attempt ${attempt}/2): ${error}`),
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
    });
  } catch (err) {
    if (err instanceof InvalidReviewOutputError) throw new ReviewError(err.message);
    throw err;
  }

  const review = normalizeReview(run.output, input.criteria);
  const decision = reconcileVerdict(review);
  if (decision.overridden) {
    logger.warning(
      `Model verdict ${decision.modelVerdict} is inconsistent with the policy; using ${decision.verdict} (${decision.reasons.join('; ')}).`,
    );
  }

  return {
    ...base,
    review: { ...review, verdict: decision.verdict },
    decision,
    usage: run.usage,
    cost: computeCost(
      model.provider,
      model.modelId,
      run.usage,
      run.providerCostUsd,
      deps.now?.() ?? new Date(),
    ),
    llmCalls: run.steps,
    llmDurationMs: run.durationMs,
    durationMs: Date.now() - started,
    skipped: false,
  };
}
