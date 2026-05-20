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
   framing on this bridge. MCP child processes use newline-delimited
   JSON in `agent/internal/mcp/` — separate code path.
3. **No stdout pollution from Go.** All Go logging goes to stderr.
4. **Request vs notification.** Requests have an `id` and expect a
   response. Notifications do not.

## Method naming

Dot-separated namespaces: `task.*`, `message.*`, `tool.*`, `system.*`.

## Adding a method

1. Add the params/result types to `src/shared/protocol.ts`.
2. Add a handler registration in TS (`agentClient.ts`) or Go
   (`main.go`).
3. Document direction, kind, and shape in `GEMINI.md` /
   `AGENTS.md` / `CLAUDE.md` under "Where things live".
4. If user-visible, surface it in the webview through `ChatPanel.ts`.

## Debugging desync

Usual cause is unframed output on the channel:
1. Add `console.error` on the TS side to dump raw stdin chunks.
2. Check Go code for `fmt.Print*` to stdout.
3. Verify `Content-Length` matches the actual byte length of the JSON
   body (UTF-8).

## Out of scope

- Changing the framing format.
- Introducing a new transport without explicit approval.
- Provider-specific message shapes — keep the protocol
  transport-neutral.
