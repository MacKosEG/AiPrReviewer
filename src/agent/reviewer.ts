import {
  isStepCount,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  ToolLoopAgent,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type ProviderMetadata,
  type ToolSet,
} from 'ai';
import type { ReviewOutput, ReviewSchema } from '../schema.js';

/** Upper bound of model calls per review run (tool calls + final answer). */
export const MAX_AGENT_STEPS = 3;

/**
 * Tools available to the reviewer. Empty for now; add entries here (e.g. a `readFile` tool backed
 * by the GitHub API) and the agent loop will use them within MAX_AGENT_STEPS without other changes.
 */
export const reviewerTools = {} satisfies ToolSet;

export interface ReviewerAgentOptions {
  model: LanguageModel;
  instructions: string;
  schema: ReviewSchema;
}

export function createReviewerAgent(options: ReviewerAgentOptions) {
  return new ToolLoopAgent({
    id: 'ai-pr-reviewer',
    model: options.model,
    instructions: options.instructions,
    tools: reviewerTools,
    output: Output.object({
      schema: options.schema,
      name: 'pull_request_review',
      description: 'Code review of a pull request against the given criteria.',
    }),
    stopWhen: isStepCount(MAX_AGENT_STEPS),
    maxRetries: 3,
  });
}

export type ReviewerAgent = ReturnType<typeof createReviewerAgent>;

export interface TokenUsage {
  inputTokens: number;
  /** All output tokens, including reasoning/thinking (that is how they are billed). */
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
}

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
};

export function addUsage(total: TokenUsage, usage: LanguageModelUsage | undefined): TokenUsage {
  if (!usage) return total;
  return {
    inputTokens: total.inputTokens + (usage.inputTokens ?? 0),
    outputTokens: total.outputTokens + (usage.outputTokens ?? 0),
    reasoningTokens: total.reasoningTokens + (usage.outputTokenDetails?.reasoningTokens ?? 0),
    cachedInputTokens: total.cachedInputTokens + (usage.inputTokenDetails?.cacheReadTokens ?? 0),
  };
}

/** Sums the real cost OpenRouter reports per step (providerMetadata.openrouter.usage.cost). */
export function openRouterCost(metadata: (ProviderMetadata | undefined)[]): number | undefined {
  let total: number | undefined;
  for (const m of metadata) {
    const cost = (m?.openrouter as { usage?: { cost?: unknown } } | undefined)?.usage?.cost;
    if (typeof cost === 'number') total = (total ?? 0) + cost;
  }
  return total;
}

export interface AgentRunResult {
  output: ReviewOutput;
  usage: TokenUsage;
  providerCostUsd: number | undefined;
  /** Model calls across all attempts. */
  steps: number;
  attempts: number;
  durationMs: number;
  responseModelId: string | undefined;
}

export interface AgentRunOptions {
  /** Builds the follow-up message after an invalid structured output. */
  retryPrompt: (error: string) => string;
  onInvalidOutput?: (error: string, attempt: number) => void;
  timeoutMs?: number;
  maxAttempts?: number;
}

export class InvalidReviewOutputError extends Error {
  constructor(
    message: string,
    readonly usage: TokenUsage,
  ) {
    super(message);
    this.name = 'InvalidReviewOutputError';
  }
}

function describeOutputError(err: NoObjectGeneratedError | NoOutputGeneratedError): string {
  const cause = (err as { cause?: unknown }).cause;
  const message = cause instanceof Error ? cause.message : err.message;
  return message.replace(/\s+/g, ' ').slice(0, 1500);
}

/**
 * Runs the agent. If the structured output does not match the schema, the agent gets one more
 * attempt with the validation error; after that the run fails (the caller fails closed).
 */
export async function runReviewerAgent(
  agent: ReviewerAgent,
  userPrompt: string,
  options: AgentRunOptions,
): Promise<AgentRunResult> {
  const started = Date.now();
  const maxAttempts = options.maxAttempts ?? 2;
  const messages: ModelMessage[] = [{ role: 'user', content: userPrompt }];
  let usage = ZERO_USAGE;
  let steps = 0;
  const metadata: (ProviderMetadata | undefined)[] = [];
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await agent.generate({
        messages,
        abortSignal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
      });
      usage = addUsage(usage, result.totalUsage);
      steps += result.steps.length;
      metadata.push(...result.steps.map((s) => s.providerMetadata));
      const output = result.output;
      return {
        output,
        usage,
        providerCostUsd: openRouterCost(metadata),
        steps,
        attempts: attempt,
        durationMs: Date.now() - started,
        responseModelId: result.response.modelId,
      };
    } catch (err) {
      if (!NoObjectGeneratedError.isInstance(err) && !NoOutputGeneratedError.isInstance(err)) {
        throw err;
      }
      steps += 1;
      if (NoObjectGeneratedError.isInstance(err)) usage = addUsage(usage, err.usage);
      lastError = describeOutputError(err);
      options.onInvalidOutput?.(lastError, attempt);
      const text = NoObjectGeneratedError.isInstance(err) ? err.text : undefined;
      if (text) messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: options.retryPrompt(lastError) });
    }
  }
  throw new InvalidReviewOutputError(
    `The model did not return a valid review after ${maxAttempts} attempts: ${lastError}`,
    usage,
  );
}
