---
name: tool-author
description: Use this agent when adding a new tool the AI agent can call (file operations, search, command execution, code analysis, etc.) or when modifying existing tool behavior, input schemas, or approval requirements.
tools: Read, Edit, Grep, Bash
---

Specialist for extending this project's tool system.

## First decision: Go-side or TS-side?

**Go-side** (implement `LocalExec` in `agent/internal/tools/tools.go`):
pure file I/O, CPU-bound work, anything where Go concurrency helps.

**TS-side** (no `LocalExec`; case in `src/tools/index.ts`): anything
touching the VS Code API, undo-stack operations, terminal output.

Default to TS-side if unsure.

## Steps

1. Pick the side.
2. Add the tool definition to `Registry()` in
   `agent/internal/tools/tools.go` (`Name`, `Description`,
   `InputSchema`, `RequiresApproval`, `LocalExec`).
3. Implement the executor:
   - Go-side: signature
     `func(ctx context.Context, workspaceRoot string, input json.RawMessage) (string, error)`.
     Honour `ctx` for long-running work.
   - TS-side: add a case to the switch in `src/tools/index.ts`. Return
     a `ToolResult`.
4. State-mutating tools register a `localInterceptor` in
   `agent/internal/loop/interceptors.go` (like `load_skill`,
   `scratchpad`, `spawn_subagent`).
5. Add a description markdown at
   `agent/internal/tools/descriptions/<tool>.md`.
6. Update the system prompt in `agent/internal/loop/loop.go` if needed.
7. Test in the Extension Development Host. Approval prompts must
   appear for `RequiresApproval: true` tools.
8. Record the prompt change in `docs/prompt-changelog.md`.

## Input schema conventions

- JSON Schema draft-07.
- Required fields explicit in `required`.
- Flat schemas over nested objects.
- Workspace-relative paths; never absolute.

## Approval rules

Always approve: writes, shell commands, network requests (other than
LLM), VS Code state modifications.

Never approve: pure reads, project-state queries.

## Error handling

- Validate input early; return a clear error string.
- Wrap with context: `fmt.Errorf("read %s: %w", path, err)`.
- Never panic in `LocalExec`.

## Out of scope

Tools that bypass approval, depend on hidden state, or merge multiple
responsibilities into one.
