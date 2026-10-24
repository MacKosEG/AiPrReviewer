/**
 * promptfoo custom provider that runs OUR reviewer agent end to end: noise filter, diff budget,
 * prompt, ToolLoopAgent with structured output, retry, verdict policy and cost accounting.
 * Assertions therefore check the final verdict the Action would publish, not a raw model answer.
 *
 * Bundled to evals/.build/provider.mjs by evals/run.mjs before promptfoo is started.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createModel, type ProviderName } from '../src/agent/model.js';
import { resolveCriteria } from '../src/criteria.js';
import { parseUnifiedDiff } from '../src/diff/parse.js';
import { runReview } from '../src/review.js';

interface ProviderOptions {
  id?: string;
  config?: { provider?: ProviderName; model?: string; maxDiffChars?: number };
}

interface CallContext {
  vars?: Record<string, unknown>;
}

const root = process.cwd();

export default class ReviewAgentProvider {
  private readonly providerId: string;
  private readonly config: NonNullable<ProviderOptions['config']>;

  constructor(options: ProviderOptions = {}) {
    this.config = options.config ?? {};
    this.providerId = options.id ?? `ai-pr-reviewer:${this.config.model ?? 'default'}`;
  }

  id(): string {
    return this.providerId;
  }

  async callApi(_prompt: string, context?: CallContext) {
    try {
      const provider = this.config.provider ?? 'google';
      const envKey = provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'GEMINI_API_KEY';
      const apiKey = process.env[envKey];
      if (!apiKey) throw new Error(`${envKey} is not set`);

      const vars = context?.vars ?? {};
      const files = parseUnifiedDiff(await readFile(path.resolve(root, String(vars.diff)), 'utf8'));
      const criteriaPath = vars.criteria ? path.resolve(root, String(vars.criteria)) : undefined;
      const { criteria } = resolveCriteria(
        criteriaPath ? await readFile(criteriaPath, 'utf8') : undefined,
      );

      const outcome = await runReview(
        {
          files,
          criteria,
          context: [],
          maxDiffChars: this.config.maxDiffChars ?? 120_000,
          ...(vars.title ? { pr: { title: String(vars.title) } } : {}),
        },
        { model: createModel({ provider, model: this.config.model ?? '', apiKey }) },
      );

      return {
        output: JSON.stringify({
          verdict: outcome.decision.verdict,
          modelVerdict: outcome.decision.modelVerdict,
          verdictOverridden: outcome.decision.overridden,
          summary: outcome.review.summary,
          criteria: outcome.review.criteria,
          findings: outcome.review.findings,
          skippedModel: outcome.skipped,
        }),
        tokenUsage: {
          prompt: outcome.usage.inputTokens,
          completion: outcome.usage.outputTokens,
          total: outcome.usage.inputTokens + outcome.usage.outputTokens,
        },
        ...(outcome.cost.usd !== undefined ? { cost: outcome.cost.usd } : {}),
        metadata: {
          model: outcome.model,
          costSource: outcome.cost.source,
          agentSteps: outcome.llmCalls,
          modelTimeMs: outcome.llmDurationMs,
          reasoningTokens: outcome.usage.reasoningTokens,
        },
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}
