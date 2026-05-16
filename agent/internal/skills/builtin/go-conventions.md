---
id: go-conventions
synopsis: idiomatic Go conventions specific to this codebase
---

When writing Go in this repo:

- **Errors are values.** Wrap with `fmt.Errorf("context: %w", err)` not
  `errors.Wrap`. Do not log and return — log at the top of the stack or
  return; not both.
- **Concurrency.** Prefer channels over shared state. Every goroutine must
  have an obvious termination story (context cancellation, a done channel,
  or a bounded loop).
- **No SDK leakage.** Keep Anthropic/OpenAI SDK types confined to
  `internal/llm/*.go`. The agent loop in `internal/loop/` must compile
  without importing those SDKs.
- **JSON-RPC framing.** All extension↔agent traffic uses LSP-style framing
  (`Content-Length` header + body). Never write plain JSON to stdout from
  the agent process; use stderr for logs.
- **Cross-platform paths.** Use `filepath.Join`, never string concatenation
  with `/`. On the wire, convert to slashes with `filepath.ToSlash` so the
  TS side sees uniform paths.
- **`gofmt` + `go vet`.** Run both before committing. Lint warnings are
  treated as errors.
