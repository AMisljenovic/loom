---
name: test-fix
description: Reproduce a bug with a failing test, apply the smallest fix, and verify narrowly.
argument-hint: bug report, failing behavior, file, or symbol
---
Use a regression-first workflow for: $ARGUMENTS

Goals:
1. Restate the bug and identify the most likely code/test surface.
2. Before editing, call `spawn_subagent` with `type: "test-scout"` to map:
   - existing coverage
   - missing scenarios
   - highest-risk regression gap
3. Add or update the nearest relevant test first so it fails for the reported behavior.
4. Implement the smallest code change that makes that test pass.
5. Run the narrowest relevant test command first; broaden only if needed.
6. Report:
   - root cause
   - changed files
   - test added/updated
   - remaining edge cases not covered

Rules:
- Prefer existing test files next to the changed unit.
- Do not start with broad refactors.
- If the bug cannot be turned into an assertion, stop and ask for the missing observable behavior.
