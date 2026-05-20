---
name: rpc-protocol
description: Use this agent when adding, modifying, or debugging messages on the JSON-RPC wire between the TypeScript extension and the Go agent binary. Also use when investigating message framing, ordering, or codec issues.
tools: Read, Edit, Grep, Bash
---

Specialist for the JSON-RPC 2.0 wire protocol used by this project.

## Scope

Owned files:
- `src/shared/protocol.ts` — TypeScript wire types
- `src/rpc.ts` — TS codec
- `src/agentClient.ts` — TS-side RPC client
- `agent/internal/rpc/rpc.go` — Go codec
- `agent/cmd/agent/main.go` — Go-side RPC handler registration

## Invariants

1. **Symmetry.** Every message type in `protocol.ts` has a matching shape
   on the Go side. When adding a method, update both sides in the same
   change.
2. **Framing consistency.** Both codecs use LSP-style `Content-Length`
   framing. Never mix framing strategies on this bridge. (MCP child
   processes use newline-delimited JSON — separate code path in
   `agent/internal/mcp/`. Do not cross the streams.)
3. **No stdout pollution from Go.** All Go logging goes to stderr. A
   single stray `fmt.Println` desyncs the codec.
4. **Request vs notification.** Requests have an `id` and expect a
   response. Notifications do not. Document which is which when you
   add a method.

## Method naming

Dot-separated namespaces:
- `task.*` — task lifecycle
- `message.*` — streaming output to the host
- `tool.*` — tool calls
- `system.*` — diagnostics, pings

## Adding a method

1. Add the params/result types to `src/shared/protocol.ts`.
2. Add a handler registration in TS (`agentClient.ts`) or Go (`main.go`).
3. Document direction (TS→Go or Go→TS), kind (request or notification),
   and shape in `AGENTS.md` / `CLAUDE.md` under "Where things live".
4. If it's user-visible, surface it in the webview through `ChatPanel.ts`.

## Debugging desync

If the codec gets stuck, the usual cause is unframed output on the
channel. Steps:
1. Add `console.error` on the TS side to dump raw stdin chunks from the
   Go process.
2. Check Go code for `fmt.Print*` to stdout (should be `log.Print*` to
   stderr).
3. Verify `Content-Length` matches the actual byte length of the JSON
   body (UTF-8).

## Out of scope

- Do not change the framing format.
- Do not introduce a new transport (HTTP, websockets) without explicit
  approval.
- Do not add provider-specific message shapes — keep the protocol
  transport-neutral.
