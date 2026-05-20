---
description: Replace the stubbed agent loop with a real Anthropic streaming call
---

Replace the stub in `agent/internal/loop/loop.go` (the `demoReadReadme`
call) with a real Anthropic streaming agent loop.

Requirements:

1. Put SDK-specific code in `agent/internal/llm/llm.go`. The `loop`
   package calls the wrapper, not the Anthropic SDK directly.
2. The loop:
   - Builds a system prompt listing tools from `tools.Registry()`.
   - Sends the user prompt as a `user` message.
   - Streams the response, forwarding text deltas via
     `d.Conn.Notify("message.delta", ...)`.
   - On `tool_use`, calls `d.ExecTool(...)` and feeds the result back
     as a `tool_result` content block on the next turn.
   - Loops until `stop_reason == "end_turn"`.
   - Notifies `task.done` with the appropriate reason.
3. Honor task cancellation via the context passed to `Run`.
4. A failed tool call is reported back to the model, not raised as a
   loop-killing error.

Read `GEMINI.md` / `AGENTS.md` for the architectural rules before
starting. Model id comes from `d.Model`. API key is in
`ANTHROPIC_API_KEY` (set by the extension when spawning the binary).

After implementing, `go vet ./...` from `agent/` and `npm run build`
from the repo root.
