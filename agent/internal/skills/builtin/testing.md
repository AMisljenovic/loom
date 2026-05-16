---
id: testing
synopsis: how to write and run tests in a typical Go or TypeScript project
---

When adding or modifying tests:

- **Go**: prefer table-driven tests in `*_test.go` alongside the code. Run with
  `go test ./...` from the module root. Use `t.Helper()` in assertion helpers
  and `testing.Short()` to gate long tests behind `-short`.
- **TypeScript/Vitest**: name files `*.test.ts` next to the unit under test.
  Run with `npx vitest run` (CI) or `npx vitest` (watch). Prefer `describe`/`it`
  blocks; avoid global setup unless absolutely necessary.

For both stacks: write the failing test first when reproducing a bug, then
verify the fix flips the assertion. Do not wrap real dependencies in mocks
unless you can articulate a specific reason — integration tests that touch
the real system catch class of issues mocks hide.
