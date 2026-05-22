---
name: protocol-sync
description: Audit wire-protocol drift between src/shared/protocol.ts and the Go counterparts. Read-only.
argument-hint: optional message-type name or file to focus on
---
Audit the TS↔Go wire protocol for drift: $ARGUMENTS

Surface to inspect:
- TS source of truth: `src/shared/protocol.ts`.
- Go counterparts live in `agent/internal/rpc/`, `agent/internal/conversation/`, `agent/internal/loop/`, `agent/internal/tools/`, and `agent/cmd/agent/main.go`.

Workflow:
1. `read_file` `src/shared/protocol.ts` (use `offset`/`limit` if it's large; do not slurp).
2. For each request/response/event type defined there, `search` for the matching Go struct or handler name in `agent/`. Prefer searching by JSON-RPC method string (e.g. `"task.start"`, `"tool.approveBatch"`) — those are the contract.
3. Build a table with columns: **method**, **TS shape**, **Go shape**, **drift?** (yes/no + one-line note).
4. Call out anything that looks like the framing or codec contract drifting (LSP `Content-Length` on this bridge — newline-delimited JSON is reserved for `agent/internal/mcp/` only).

Rules:
- Pure read. No `apply_diff`, no `run_command` that mutates state.
- If a TS type has no Go counterpart, flag it; do not assume it's TS-only without confirming the message never crosses the wire.
- Spawn `spawn_subagent type: "protocol-auditor"` if the surface is wide and the parent context is already loaded — the sub-agent returns a compact diff table.
