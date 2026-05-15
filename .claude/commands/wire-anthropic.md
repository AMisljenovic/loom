---
description: Replace the stubbed agent loop with a real Anthropic streaming call
---

Replace the stub in `agent/internal/loop/loop.go` (the `demoReadReadme` call)
with a real Anthropic streaming agent loop.

Requirements:

1. Put SDK-specific code in `agent/internal/llm/llm.go`. The `loop` package
   should not import the Anthropic SDK directly — it should call the wrapper.
2. The loop should:
   - Build a system prompt that lists tools from `tools.Registry()` with
     their names, descriptions, and input schemas.
   - Send the user prompt as a `user` message.
   - Stream the response, forwarding text deltas via
     `d.Conn.Notify("message.delta", ...)`.
   - When the model emits a `tool_use` block, call `d.ExecTool(...)` and
     feed the result back as a `tool_result` content block on the next turn.
   - Loop until the model returns `stop_reason == "end_turn"`.
   - Notify `task.done` with the appropriate reason.
3. Honor task cancellation via the context passed to `Run`.
4. Keep error handling robust — a failed tool call should be reported to the
   model so it can retry or recover, not crash the loop.

Read `CLAUDE.md` for the architectural rules before starting. The model id
comes from `d.Model`. The API key is in the `ANTHROPIC_API_KEY` env var
(already set by the extension when spawning the binary).

After implementing, run `go vet ./...` from `agent/` and `npm run build` from
the repo root. Verify the binary still spawns and exchanges messages.
