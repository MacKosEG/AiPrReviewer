import { readFileSync } from 'node:fs';
import { MockLanguageModelV4 } from 'ai/test';
import { vi } from 'vitest';
import type { ModelSelection, ProviderName } from '../src/agent/model.js';
import type { GitHubApi, IssueComment, PullFile } from '../src/github/api.js';
import type { Criterion } from '../src/types.js';

export function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}

type ReviewJson = {
  verdict: string;
  summary: string;
  criteria: { id: string; name: string; status: string; comment: string }[];
  findings: Record<string, unknown>[];
};

export function reviewJson(
  criteria: Criterion[],
  overrides: Partial<ReviewJson> & { statuses?: Record<string, string> } = {},
): string {
  const { statuses = {}, ...rest } = overrides;
  const body: ReviewJson = {
    verdict: 'APPROVED',
    summary: 'Looks good.',
    criteria: criteria.map((c) => ({
      id: c.id,
      name: c.name,
      status: statuses[c.id] ?? 'pass',
      comment: 'ok',
    })),
    findings: [],
    ...rest,
  };
  return JSON.stringify(body);
}

export interface MockModelOptions {
  provider?: ProviderName;
  modelId?: string;
  /** OpenRouter-style cost reported per call in providerMetadata. */
  costPerCall?: number;
  /** Throw this error from the first call instead of answering. */
  failWith?: Error;
}

/**
 * AI SDK mock language model that answers with the given texts in order (the last one repeats).
 * Each call reports 1000 input tokens and 500 output tokens (300 of them reasoning).
 */
export function mockModel(texts: string[], options: MockModelOptions = {}) {
  const provider = options.provider ?? 'google';
  const modelId = options.modelId ?? 'gemini-3.8-flash';
  let i = 0;
  const model = new MockLanguageModelV4({
    provider,
    modelId,
    doGenerate: async () => {
      if (options.failWith) throw options.failWith;
      const text = texts[Math.min(i++, texts.length - 1)] ?? '';
      return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'STOP' },
        usage: {
          inputTokens: { total: 1000, noCache: 900, cacheRead: 100, cacheWrite: undefined },
          outputTokens: { total: 500, text: 200, reasoning: 300 },
        },
        warnings: [],
        ...(options.costPerCall !== undefined
          ? { providerMetadata: { openrouter: { usage: { cost: options.costPerCall } } } }
          : {}),
        response: { modelId },
      };
    },
  });
  const selection: ModelSelection = { provider, modelId, model };
  /** Concatenated text of every prompt the model received, one entry per call. */
  const prompts = () => model.doGenerateCalls.map((call) => JSON.stringify(call.prompt));
  return { selection, model, prompts };
}

export interface FakeGitHubOptions {
  files?: PullFile[];
  /** path -> content at the base ref */
  repoFiles?: Record<string, string>;
  comments?: IssueComment[];
}

export function fakeGitHub(options: FakeGitHubOptions = {}) {
  const comments = [...(options.comments ?? [])];
  let nextId = 1000;
  const api = {
    listPullFiles: vi.fn(async () => options.files ?? []),
    getFileContent: vi.fn(async (_repo, path: string, _ref: string) => options.repoFiles?.[path]),
    listIssueComments: vi.fn(async () => comments),
    createComment: vi.fn(async (_repo, _issue: number, body: string) => {
      const c: IssueComment = {
        id: nextId++,
        body,
        html_url: 'https://github.com/o/r/pull/1#c',
        user: { login: 'github-actions[bot]', type: 'Bot' },
      };
      comments.push(c);
      return c;
    }),
    updateComment: vi.fn(async (_repo, id: number, body: string) => {
      const c = comments.find((x) => x.id === id);
      if (!c) throw new Error('not found');
      c.body = body;
      return c;
    }),
  } satisfies GitHubApi;
  return { api, comments };
}

export function pullFilesFromDiff(
  files: { path: string; patch?: string; status?: string }[],
): PullFile[] {
  return files.map((f) => {
    const lines = (f.patch ?? '').split('\n');
    const file: PullFile = {
      filename: f.path,
      status: f.status ?? 'modified',
      additions: lines.filter((l) => l.startsWith('+')).length,
      deletions: lines.filter((l) => l.startsWith('-')).length,
    };
    if (f.patch !== undefined) file.patch = f.patch;
    return file;
  });
}
