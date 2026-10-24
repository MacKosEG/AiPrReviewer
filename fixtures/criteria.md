# AI review criteria

Each `## heading` below is one criterion. The text under the heading tells the reviewer what to check.
The reviewer marks every criterion as pass / warn / fail; any fail blocks the merge.

## Correctness

The change does what the PR says. No logic errors, off-by-one mistakes, inverted conditions,
wrong operators or regressions of existing behaviour.

## Security

No SQL/command/path injection, no XSS, no hardcoded secrets, tokens or passwords. User input is
validated, queries are parameterized, authorization is checked before data access.

## Tests

New or changed logic has unit tests that cover the main path and the important edge cases.
Docs-only, config-only or pure refactoring changes do not need new tests.

- **pass**: changed logic is tested, or the change needs no tests.
- **warn**: tests are missing or incomplete for new or changed logic.
- **fail**: existing tests were removed or weakened to make the change pass.

## Error handling

Errors are handled explicitly and not swallowed. Inputs at boundaries (null, empty, negative,
too large) are handled. External calls handle failures and timeouts.

## Code quality

Code is readable and consistent with the codebase: clear names, small functions, no dead code,
no copy-paste duplication, comments explain non-obvious intent.
