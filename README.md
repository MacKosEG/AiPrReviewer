# ai-pr-reviewer

A reusable GitHub Action that reviews a pull request with an AI agent (Gemini via the
[Vercel AI SDK](https://ai-sdk.dev)) and returns a **hard verdict**: `APPROVED`, `NEEDS_WORK` or
`DECLINED`. It posts **one** review comment on the PR, updates it on every push, and fails the
check according to `fail-on`, so it can be a required status check.

## How it works

```
pull_request event
  └─ GitHub API: list PR files (paginated)        ── never logs the diff
       └─ noise filter: lockfiles, generated, binaries, snapshots
            └─ diff budget (max-diff-chars) ── partial review is stated explicitly
                 └─ criteria + optional context files (read from the PR *base* commit)
                      └─ ToolLoopAgent (AI SDK 7) + Output.object(zod schema), stopWhen: isStepCount(3)
                           └─ schema validation (1 retry with the error) ── fail closed after that
                                └─ verdict policy in code (overrides the model if inconsistent)
                                     └─ upsert PR comment (hidden marker) → output `verdict` → exit code
```

- **Structured output**: the agent must return `verdict`, `summary`, `criteria[]` (exactly one entry
  per criterion, enforced via enum ids and array length) and `findings[]`. The output is validated
  with zod; an invalid answer gets one retry with the validation error, then the step fails
  (no fake verdict).
- **Verdict policy** (`src/verdict.ts`), enforced in code:
  - any criterion `fail` **or** any `critical` finding → `DECLINED`
  - otherwise any criterion `warn` **or** any `major` finding → `NEEDS_WORK`
  - otherwise → `APPROVED` (`minor` findings are allowed)

  If the model's own verdict disagrees, it is overridden, logged as a warning and noted in the comment.

- **Criteria vs. mechanics**: the review mechanics (prompt, schema, severities, verdict policy) live in
  code. The criteria and their rubric (what pass / warn / fail mean) live in markdown:
  [`config/default-criteria.md`](config/default-criteria.md) ships with the Action, and a criteria
  file in the consumer repo **replaces** it completely.
- **Agent**: `src/agent/reviewer.ts` builds a `ToolLoopAgent` with no tools yet. Tools can be added to
  `reviewerTools` (e.g. reading more files through the GitHub API) without changing the rest; the loop
  is capped at 3 steps.
- **Security**: criteria and context files are read from the PR's base commit, so a PR cannot weaken its
  own review. Diff, PR text and context are passed as untrusted data, and the model is told to ignore
  instructions in them. API keys are masked. The diff, prompt and response are never logged.

## Usage

Pin the Action to a **full commit SHA** (immutable), with the version in a comment:

```yaml
# .github/workflows/ai-review.yml
name: AI review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: ai-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  ai-review:
    name: ai-review
    if: ${{ !github.event.pull_request.draft }}
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: mackos-eg/AiPrReviewer@9036ebdfafd8d40ff10abc7a365b806728b17441 # v1.0.0
        with:
          gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
          # model: gemini-4-argon
          # fail-on: NEEDS_WORK
          # context-files: |
          #   AGENTS.md
          #   docs/PRD.md
```

`9036ebdfafd8d40ff10abc7a365b806728b17441` is the commit of `v1.0.0`. For later releases, get the SHA of a tag with:

```bash
git ls-remote https://github.com/mackos-eg/AiPrReviewer 'refs/tags/v1.0.0^{}' 'refs/tags/v1.0.0'
```

(For an annotated tag use the `^{}` line, which is the commit; for a lightweight tag only the plain line exists.)
Dependabot and Renovate can keep SHA pins with `# vX.Y.Z` comments up to date.

No `actions/checkout` is needed: everything is read through the GitHub API.

### Inputs

| Input                | Required | Default                         | Description                                                                                                      |
| -------------------- | -------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `gemini-api-key`     | yes      |                                 | Google AI Studio API key. Pass it from a secret.                                                                 |
| `github-token`       | no       | `${{ github.token }}`           | Reads the PR and writes the comment (`pull-requests: write`, `contents: read`).                                  |
| `provider`           | no       | `google`                        | `google` (uses `gemini-api-key`) or `openrouter` (uses `openrouter-api-key`).                                    |
| `openrouter-api-key` | no       | `''`                            | Only for `provider: openrouter`.                                                                                 |
| `model`              | no       | provider default                | `google`: `gemini-3.8-flash`; `openrouter`: `google/gemini-3.8-flash`. E.g. `gemini-4-argon` for deeper reviews. |
| `criteria-file`      | no       | `.github/ai-review-criteria.md` | Criteria markdown in the consumer repo (read at the base commit). Missing → built-in defaults.                   |
| `context-files`      | no       | `''`                            | Comma/newline-separated extra context (PRD, AGENTS.md…). Max 10 files, 20k chars each, 60k total.                |
| `fail-on`            | no       | `DECLINED`                      | `DECLINED`, `NEEDS_WORK` (fails on both) or `never`.                                                             |
| `max-diff-chars`     | no       | `120000`                        | Diff budget sent to the model. Files that do not fit are omitted and listed in the comment.                      |

### Outputs

| Output    | Description                                                     |
| --------- | --------------------------------------------------------------- |
| `verdict` | `APPROVED`, `NEEDS_WORK` or `DECLINED` (after the code policy). |

### Exit code

| Verdict      | `fail-on: DECLINED` | `fail-on: NEEDS_WORK` | `fail-on: never` |
| ------------ | ------------------- | --------------------- | ---------------- |
| `APPROVED`   | pass                | pass                  | pass             |
| `NEEDS_WORK` | pass                | **fail**              | pass             |
| `DECLINED`   | **fail**            | **fail**              | pass             |

Technical errors (missing key, API errors, invalid model output after the retry) always fail the step
and replace the comment with a "review failed" note.

### Criteria file

Every `## heading` is one criterion (id = slugified heading, or an explicit `{#id}`), the text under it
describes what to check, and optional rubric bullets define each status:

```markdown
# AI review criteria

## Security {#security}

No injection, no hardcoded secrets, authorization checked before data access.

- **pass**: no security-relevant problems.
- **warn**: missing hardening, nothing directly exploitable.
- **fail**: exploitable issue (injection, leaked secret, missing auth).

## Tests

New logic has unit tests for the main path and edge cases. Docs/config-only changes need no tests.

- **warn**: tests missing for new or changed logic.
- **fail**: tests removed or weakened to make the change pass.
```

Without rubric bullets the generic definitions apply (pass = no problems, warn = should fix but not
blocking, fail = blocking). Up to 20 criteria. See [`config/default-criteria.md`](config/default-criteria.md)
for the built-in six (correctness, security, tests, error handling, maintainability, performance).

### Noise filtering and partial reviews

Skipped as noise (listed in the comment): lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`,
`go.sum`, `Cargo.lock`, `poetry.lock`, …), generated files (`dist/**`, `build/**`, `*.min.*`, `*.map`,
`*.generated.*`, `__generated__/`, protobuf output), snapshots (`*.snap`, `__snapshots__/`) and binaries.
If the remaining diff exceeds `max-diff-chars`, whole files are omitted (only the first file can be
cut at a hunk boundary). Files GitHub returns without a patch (too large) are reported too. The comment
then shows a **Partial review** warning, and the model is told what it did not see.

### Logs and cost

The job log shows: model and provider, file counts (changed / noise / reviewed / omitted), diff size,
model time and agent steps, total time, tokens from the AI SDK result (`input`, `cached`, `output`,
`reasoning`) and cost:

- `provider: google`: tokens × rates from [`config/pricing.json`](config/pricing.json), shown as `~$…`.
  The rates are paid-tier prices; free-tier usage costs nothing. Update the file when prices change
  (Gemini 4 Argon doubles on 2026-12-01, Gemini 3.8 Flash on 2027-01-01).
- `provider: openrouter`: the real cost reported by OpenRouter in `providerMetadata`.

### Fork pull requests

Workflows triggered by `pull_request` from forks get no secrets, so the step fails with an explanation.
Do not switch to `pull_request_target` to work around this: it runs with secrets against untrusted code,
and the PR author could exfiltrate the key through the review prompt or the workflow itself.

## Local development

Requires Node 22+ (the Action runs on `node24`).

```bash
npm ci
npm run all          # lint + typecheck + tests + build
```

Run a review locally against a diff file (prints JSON, publishes nothing):

```bash
export GEMINI_API_KEY=...            # PowerShell: $env:GEMINI_API_KEY="..."
npm run review -- --diff fixtures/security.diff --criteria fixtures/criteria.md
npm run review -- --diff fixtures/good.diff --model gemini-4-argon --fail-on DECLINED
npm run review -- --diff fixtures/logic-bug.diff --print-prompt   # no API call
git diff main...HEAD > my.diff && npm run review -- --diff my.diff
```

`dist/` is committed (GitHub runs it directly). CI fails if it is not rebuilt: run `npm run build` and
commit `dist/` together with source changes.

### Tests

`npm test` runs vitest. The model is mocked with the AI SDK's `MockLanguageModelV4`, so the real
`ToolLoopAgent` / structured-output / retry path is tested. GitHub is mocked through a small API
interface. The tests cover diff parsing and filtering, the diff budget, criteria and rubric parsing, the
schema, the verdict policy, cost, comment rendering and updating, and exit codes.

## Evals (promptfoo)

`evals/` compares models on five fixture PRs. Every provider runs **our agent** end to end
(`evals/provider.ts`), so the assertions check the verdict the Action would publish:

| Fixture              | Expected                                      |
| -------------------- | --------------------------------------------- |
| `good.diff`          | `APPROVED`                                    |
| `security.diff`      | `DECLINED`, security `fail`, critical finding |
| `missing-tests.diff` | `NEEDS_WORK`, tests not `pass`                |
| `logic-bug.diff`     | `DECLINED`, finding in `src/auth/session.ts`  |
| `noise-only.diff`    | `APPROVED`, nothing reported on noise files   |

Models: `gemini-3.8-flash` and `gemini-4-argon` (Google AI Studio), plus `anthropic/claude-sonnet-5.5`
through OpenRouter when `OPENROUTER_API_KEY` is set (otherwise it is skipped with a warning).

```bash
export GEMINI_API_KEY=...
export OPENROUTER_API_KEY=...        # optional
npm run eval                          # table with pass/fail, cost and latency per model
npm run eval:view                     # browse results in the promptfoo UI
EVAL_MODELS=gemini-3.8-flash npm run eval -- --filter-first-n 2
```

Reports are written to `evals/output/results.html` and `results.json`. `OPENROUTER_MODEL` overrides
the OpenRouter model.

### Eval results

Run on 2026-10-28 (`npm run eval`, all 5 tests, no filters, concurrency 2, `--no-cache`). OpenRouter
was skipped (no `OPENROUTER_API_KEY`). Cost is the paid-tier estimate from `config/pricing.json`.
Time is the end-to-end latency per case.

| Test            | `gemini-3.8-flash`               | `gemini-4-argon`                 |
| --------------- | -------------------------------- | -------------------------------- |
| `good`          | ✅ APPROVED · $0.0073 · 15.0 s   | ✅ APPROVED · $0.0109 · 8.3 s    |
| `security`      | ✅ DECLINED · $0.0068 · 13.9 s   | ✅ DECLINED · $0.0174 · 15.3 s   |
| `missing-tests` | ✅ NEEDS_WORK · $0.0090 · 18.9 s | ✅ NEEDS_WORK · $0.0183 · 18.4 s |
| `logic-bug`     | ✅ DECLINED · $0.0095 · 20.1 s   | ✅ DECLINED · $0.0152 · 15.5 s   |
| `noise-only`    | ✅ APPROVED · $0.0024 · 4.9 s    | ✅ APPROVED · $0.0055 · 16.9 s   |
| **Total**       | **5/5 · $0.0349 · avg 14.5 s**   | **5/5 · $0.0673 · avg 14.9 s**   |

Default model: `gemini-3.8-flash`. It scores the same as `gemini-4-argon` for about half the cost,
with the same latency. Five fixtures cannot separate the two models on accuracy, so use
`gemini-4-argon` when you need deeper reviews of large or subtle changes.

## Releasing

```bash
npm run all && git status                 # dist/ must be committed and clean
git tag -a v1.0.0 -m "v1.0.0"
git push origin v1.0.0
git rev-list -n 1 v1.0.0                  # the commit SHA consumers pin to
gh release create v1.0.0 --title v1.0.0 --notes "First release"
```

Optionally also move a major tag for people who prefer `@v1`
(`git tag -fa v1 -m v1 v1.0.0^{} && git push -f origin v1`). The documented usage pins the SHA.
