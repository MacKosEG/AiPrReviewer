import { describe, expect, it } from 'vitest';
import { loadDefaultCriteria } from '../src/criteria.js';
import { findReviewComment, upsertReviewComment } from '../src/github/comment.js';
import {
  COMMENT_MARKER,
  MAX_COMMENT_CHARS,
  renderComment,
  renderFailureComment,
} from '../src/render.js';
import type { ReviewOutcome } from '../src/review.js';
import { fakeGitHub } from './helpers.js';

const repo = { owner: 'o', repo: 'r' };

function outcome(overrides: Partial<ReviewOutcome> = {}): ReviewOutcome {
  return {
    review: {
      verdict: 'DECLINED',
      summary: 'Adds a user search endpoint.',
      criteria: loadDefaultCriteria().map((c) => ({
        id: c.id,
        name: c.name,
        status: c.id === 'security' ? 'fail' : 'pass',
        comment: c.id === 'security' ? 'SQL built by | concatenation\nsecond line' : 'ok',
      })),
      findings: [
        {
          file: 'src/users.ts',
          line: 25,
          severity: 'critical',
          message: 'SQL injection',
          suggestion: 'Use $1 params.',
        },
        {
          file: 'src/users.ts',
          line: undefined,
          severity: 'minor',
          message: 'Naming',
          suggestion: undefined,
        },
      ],
    },
    decision: {
      verdict: 'DECLINED',
      reasons: ['failed criteria: security'],
      modelVerdict: 'NEEDS_WORK',
      overridden: true,
    },
    model: 'gemini-3.8-flash',
    provider: 'google',
    usage: { inputTokens: 1200, outputTokens: 400, reasoningTokens: 100, cachedInputTokens: 0 },
    cost: { usd: 0.0024, source: 'config' },
    llmCalls: 1,
    llmDurationMs: 1000,
    durationMs: 1200,
    stats: {
      totalFiles: 3,
      filteredFiles: 1,
      reviewedFiles: 2,
      omittedFiles: 0,
      diffChars: 500,
      sentDiffChars: 500,
    },
    filtered: [{ path: 'package-lock.json', reason: 'lockfile' }],
    omissions: [],
    skipped: false,
    ...overrides,
  };
}

const meta = {
  repoUrl: 'https://github.com/o/r',
  headSha: 'abcdef1234567890',
  criteriaSource: 'default' as const,
};

describe('renderComment', () => {
  it('renders verdict, criteria table, findings and footer', () => {
    const body = renderComment(outcome(), meta);
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain('## 🤖 AI review: ⛔ DECLINED');
    expect(body).toContain(
      '| ❌ fail | Security | SQL built by \\| concatenation<br>second line |',
    );
    expect(body).toContain('#### 🔴 Critical (1)');
    expect(body).toContain(
      '[`src/users.ts:25`](https://github.com/o/r/blob/abcdef1234567890/src/users.ts#L25)',
    );
    expect(body).toContain('💡 Use $1 params.');
    expect(body).toContain('Verdict adjusted by policy: the model said **NEEDS_WORK**');
    expect(body).toContain('`package-lock.json` (lockfile)');
    expect(body).toContain('model `gemini-3.8-flash`');
    expect(body).toContain('commit abcdef1');
    expect(body).not.toContain('Partial review');
  });

  it('shows a partial review warning', () => {
    const body = renderComment(outcome({ omissions: ['2 file(s) omitted: a.ts, b.ts'] }), meta);
    expect(body).toContain('**Partial review**');
    expect(body).toContain('> - 2 file(s) omitted: a.ts, b.ts');
  });

  it('stays below the GitHub comment size limit', () => {
    const many = Array.from({ length: 3000 }, (_, i) => ({
      file: `src/f${i}.ts`,
      line: i + 1,
      severity: 'minor' as const,
      message: 'x'.repeat(50),
      suggestion: undefined,
    }));
    const o = outcome();
    const body = renderComment({ ...o, review: { ...o.review, findings: many } }, meta);
    expect(body.length).toBeLessThanOrEqual(MAX_COMMENT_CHARS);
    expect(body).toContain('Comment truncated');
  });

  it('renders a failure comment with the marker', () => {
    const body = renderFailureComment('boom', meta);
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain('review failed');
    expect(body).toContain('boom');
  });
});

describe('upsertReviewComment', () => {
  it('creates a comment when none has the marker', async () => {
    const { api } = fakeGitHub({
      comments: [{ id: 1, body: 'hello', html_url: 'u1', user: { login: 'dev', type: 'User' } }],
    });
    const result = await upsertReviewComment(api, repo, 7, `${COMMENT_MARKER}\nnew`);
    expect(result.action).toBe('created');
    expect(api.createComment).toHaveBeenCalledWith(repo, 7, `${COMMENT_MARKER}\nnew`);
    expect(api.updateComment).not.toHaveBeenCalled();
  });

  it('updates the existing marked comment instead of creating a new one', async () => {
    const comments = Array.from({ length: 150 }, (_, i) => ({
      id: i + 1,
      body: `comment ${i}`,
      html_url: `u${i}`,
      user: { login: 'dev', type: 'User' },
    }));
    comments[120] = {
      id: 121,
      body: `${COMMENT_MARKER}\nold`,
      html_url: 'u121',
      user: { login: 'github-actions[bot]', type: 'Bot' },
    };
    const { api } = fakeGitHub({ comments });
    const result = await upsertReviewComment(api, repo, 7, `${COMMENT_MARKER}\nnew`);
    expect(result).toEqual({ action: 'updated', id: 121, url: 'u121' });
    expect(api.updateComment).toHaveBeenCalledWith(repo, 121, `${COMMENT_MARKER}\nnew`);
    expect(api.createComment).not.toHaveBeenCalled();
  });

  it('is idempotent across runs', async () => {
    const { api, comments } = fakeGitHub();
    await upsertReviewComment(api, repo, 7, `${COMMENT_MARKER}\nrun 1`);
    await upsertReviewComment(api, repo, 7, `${COMMENT_MARKER}\nrun 2`);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain('run 2');
  });

  it('prefers the bot comment over a user comment quoting the marker', () => {
    const found = findReviewComment([
      {
        id: 1,
        body: `quote ${COMMENT_MARKER}`,
        html_url: 'a',
        user: { login: 'dev', type: 'User' },
      },
      {
        id: 2,
        body: COMMENT_MARKER,
        html_url: 'b',
        user: { login: 'github-actions[bot]', type: 'Bot' },
      },
    ]);
    expect(found?.id).toBe(2);
  });
});
