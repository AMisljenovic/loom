---
description: Add a new tool the AI agent can call
argument-hint: <tool_name> <one-line description>
---

Add a new tool named `$1` to this project. Description: $2

Use the `tool-author` subagent for this work.

Steps:

1. Decide whether this tool runs in Go (`agent/internal/tools/tools.go`) or
   TypeScript (`src/tools/index.ts`) based on whether it needs the VS Code API.
2. Add the tool definition to `Registry()` in `agent/internal/tools/tools.go`
   with a proper `InputSchema` and `RequiresApproval` set correctly.
3. Implement the executor on the chosen side. State-mutating tools
   (`load_skill`-style) leave `LocalExec` nil and register a
   `localInterceptor` in `agent/internal/loop/interceptors.go`.
4. Add `agent/internal/tools/descriptions/<tool>.md` — the markdown the
   model sees verbatim. Keep the body under the 400-word cap enforced by
   `descriptions_test.go`.
5. Update the system prompt in `agent/internal/loop/loop.go` if the new
   tool needs explicit mention beyond the auto-listed registry.
6. Run `npm run build` and verify it compiles.
7. Record the prompt change in `docs/prompt-changelog.md`.
8. Briefly explain to me how to test it in the Extension Development Host.

Default to `RequiresApproval: true` if the tool writes or executes anything.
