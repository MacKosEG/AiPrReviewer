# Default review criteria

These criteria are used when the consumer repository has no criteria file
(input `criteria-file`, default `.github/ai-review-criteria.md`). A consumer file **replaces**
this list completely.

Format (the same for consumer files):

- every `## Heading` is one criterion; its id is the slugified heading, or an explicit `{#id}` suffix,
- the text under the heading describes what to check,
- optional rubric bullets `- **pass**: …`, `- **warn**: …`, `- **fail**: …` define each status for this
  criterion. Without them the reviewer uses the generic definitions.

Mechanics (output schema, severities, verdict rule) live in the code, not here.

## Correctness {#correctness}

The change does what the PR claims and does not break existing behaviour.

- **pass**: the logic is correct for the main path and the edge cases visible in the diff.
- **warn**: a likely bug in a rare edge case, or behaviour that is ambiguous and should be confirmed.
- **fail**: a definite bug: wrong condition or operator, off-by-one, broken control flow, a regression of existing behaviour.

## Security {#security}

Untrusted input, secrets and access control are handled safely.

- **pass**: no security-relevant problems in the change.
- **warn**: hardening is missing (e.g. weak validation, overly broad permissions, sensitive data in logs) but nothing is directly exploitable.
- **fail**: an exploitable issue: SQL/command/path injection, XSS, hardcoded secrets or credentials, missing authentication or authorization, exposure of sensitive data.

## Tests {#tests}

New or changed behaviour is covered by meaningful automated tests.

- **pass**: changed logic has tests for the main path and important edge cases, or the change does not need tests (docs, config, pure renames).
- **warn**: tests are missing or clearly incomplete for new or changed logic.
- **fail**: existing tests were removed or weakened to make the change pass, or a critical path (security, money, data integrity) changed without any test.

## Error handling & edge cases {#error-handling}

Failures and boundary values are handled explicitly.

- **pass**: errors are handled or propagated deliberately; null, empty and boundary inputs are covered.
- **warn**: some failure modes are unhandled (timeouts, empty input, unexpected API responses) or errors are logged without context.
- **fail**: errors are silently swallowed in a way that hides failures or corrupts data, or a common input crashes the code.

## Readability & maintainability {#maintainability}

The code is clear and consistent with the surrounding codebase.

- **pass**: clear names, reasonable function size, no dead code or needless duplication.
- **warn**: noticeable readability problems: confusing names, duplicated logic, large functions, misleading comments.
- **fail**: only for severe problems that make the code very hard to change safely; style nits are never a fail.

## Performance {#performance}

No obvious inefficiencies for the expected data sizes.

- **pass**: no performance concerns, or the code is not performance-sensitive.
- **warn**: avoidable inefficiency: repeated work in loops, N+1 queries, unnecessary allocations on a hot path.
- **fail**: a clear scalability problem in a main path: unbounded memory growth, quadratic work on large inputs, blocking I/O in a request loop.
