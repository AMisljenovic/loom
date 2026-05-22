---
id: wire-protocol-message
synopsis: add or modify a JSON-RPC message on the TS extension ↔ Go agent bridge
triggers: [protocol.ts, rpc, json-rpc, content-length, message, framing, task.start, tool.call, ChatPanel]
---

The TS extension and the Go agent talk over **LSP-style framed JSON-RPC 2.0**
on the agent process's stdio. `Content-Length: N\r\n\r\n<body>`. Newline-delimited
JSON is reserved for `agent/internal/mcp/` (external MCP servers) — do not mix
the two.

## Adding a new message

1. **Define the type in `src/shared/protocol.ts`.** This is the single source
   of truth for shapes that cross the wire. Use precise types — `unknown` +
   narrowing is fine for opaque payloads, never `any`. Group by direction:
   `HostToAgent` / `AgentToHost`, or for webview: `HostToWebview` / `WebviewToHost`.

2. **Mirror in Go.** The matching Go struct goes in the package that owns the
   feature:
   - Task lifecycle → `agent/internal/loop/` (e.g. `TaskStartParams`).
   - Conversation/session state → `agent/internal/conversation/`.
   - Tool request/response → `agent/internal/tools/`.
   - Low-level transport → `agent/internal/rpc/`.
   JSON tags must match the TS field names exactly (`json:"toolCallId"`, not
   `"tool_call_id"`).

3. **Route on the TS side.** `src/agentClient.ts` owns the request/notification
   dispatch. Add a typed method (`async startTask(params: TaskStartParams)`) or
   a notification handler. The codec lives in `src/rpc.ts` — do not bypass it.

4. **Route on the Go side.** `agent/cmd/agent/main.go` wires the method name
   ("task.start", "tool.approveBatch") to its handler. The codec lives in
   `agent/internal/rpc/rpc.go`.

5. **Test.** Round-trip the new message in a TS unit test (`npm run test:ts`)
   and a Go unit test (`go test ./...`). For loop-integration tests, prefer
   the in-memory transport already used by existing tests over a real
   subprocess spawn.

## Framing rules

- Every request gets one response. Notifications get none.
- The agent must never write plain JSON to stdout — use stderr for logging.
- Tool results that travel back from TS to Go follow the same framing; the
  `LocalExec`-less side just attaches its result to the existing `tool.call`
  request.

## When to send through the agent vs straight to the webview

If the data needs to participate in the agent loop (tokens, tool calls,
conversation state), it goes through the Go agent. If it's purely UI
chrome (theme toggles, sidebar collapse, popovers), it stays inside the
host↔webview `postMessage` bridge in `src/panel/ChatPanel.ts`. Do not
proxy webview chrome through Go.

## Common drift to watch for

- A new TS field with no JSON tag mirror on the Go side — the field arrives
  empty and the failure mode is silent.
- A method renamed on one side only — the other side returns
  `MethodNotFound` and the loop may swallow it.
- Adding `optional?` in TS but a non-pointer field in Go — the zero value
  collides with "omitted".
