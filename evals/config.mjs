/**
 * Eval definition. evals/run.mjs turns this into a promptfoo config. Every provider entry runs our
 * reviewer agent (evals/provider.ts); the OpenRouter one is added only when OPENROUTER_API_KEY is set.
 */

// Multi-line values are run by promptfoo as a function body (single-line ones as an expression).
const parse = 'const r = JSON.parse(output);\n';

/** Two Gemini models compared through Google AI Studio. */
export const geminiModels = ['gemini-3.8-flash', 'gemini-4-argon'];

/** Non-Google model compared through OpenRouter (only when OPENROUTER_API_KEY is set). */
export const openRouterModel = 'anthropic/claude-sonnet-5.5';

export const tests = [
  {
    description: 'good: well-tested slugify utility',
    vars: {
      diff: 'fixtures/good.diff',
      criteria: 'fixtures/criteria.md',
      title: 'Add slugify for article URLs',
    },
    assert: [{ type: 'javascript', value: `${parse} return r.verdict === 'APPROVED';` }],
  },
  {
    description: 'security: SQL injection and hardcoded live API key',
    vars: {
      diff: 'fixtures/security.diff',
      criteria: 'fixtures/criteria.md',
      title: 'Add user search and refunds',
    },
    assert: [
      { type: 'javascript', value: `${parse} return r.verdict === 'DECLINED';` },
      {
        type: 'javascript',
        value: `${parse} return r.criteria.some((c) => c.id === 'security' && c.status === 'fail');`,
      },
      {
        type: 'javascript',
        value: `${parse} return r.findings.some((f) => f.severity === 'critical' && f.file === 'src/routes/users.ts');`,
      },
    ],
  },
  {
    description: 'missing tests: new discount logic without tests',
    vars: {
      diff: 'fixtures/missing-tests.diff',
      criteria: 'fixtures/criteria.md',
      title: 'Add customer discounts',
    },
    assert: [
      { type: 'javascript', value: `${parse} return r.verdict === 'NEEDS_WORK';` },
      {
        type: 'javascript',
        value: `${parse} return r.criteria.some((c) => c.id === 'tests' && c.status !== 'pass');`,
      },
    ],
  },
  {
    description: 'logic bug: inverted session expiry check',
    vars: {
      diff: 'fixtures/logic-bug.diff',
      criteria: 'fixtures/criteria.md',
      title: 'Sliding session expiration',
    },
    assert: [
      { type: 'javascript', value: `${parse} return r.verdict === 'DECLINED';` },
      {
        type: 'javascript',
        value: `${parse} return r.findings.some((f) => f.file === 'src/auth/session.ts' && (f.severity === 'critical' || f.severity === 'major'));`,
      },
    ],
  },
  {
    description: 'noise: lockfile, dist, snapshot, binary + README typo',
    vars: {
      diff: 'fixtures/noise-only.diff',
      criteria: 'fixtures/criteria.md',
      title: 'Bump semver, fix typo',
    },
    assert: [
      { type: 'javascript', value: `${parse} return r.verdict === 'APPROVED';` },
      {
        type: 'javascript',
        value: `${parse} return r.findings.every((f) => !['package-lock.json', 'dist/index.js'].includes(f.file));`,
      },
    ],
  },
];
