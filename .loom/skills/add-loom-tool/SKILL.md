---
id: add-loom-tool
synopsis: add a new tool the agent can call (Go-side, TS-side, or state-mutating interceptor)
triggers: [tool, Tool, LocalExec, RequiresApproval, interceptor, tools.go, apply_diff, read_file, load_skill, spawn_subagent, scratchpad]
---

A "tool" here means an entry in `agent/internal/tools/tools.go` that the
LLM can invoke via JSON Schema. There are three dispatch shapes; pick one.

## Decision tree

- **Touches the VS Code API** (editor edits, terminal, diagnostics, webview) →
  TS-side tool. Set `LocalExec` to `nil` in `tools.go`; add a case in the
  switch in `src/tools/index.ts`. The Go loop sends a `tool.call` RPC and
  the TS side executes.
- **Pure computation or file I/O on the agent process** → Go-side tool.
  Implement `LocalExec` directly. Signature:
  `func(ctx context.Context, workspaceRoot string, input json.RawMessage) (string, error)`.
  Honour `ctx` for any long-running work so user cancel propagates.
- **Mutates conversation state or fans out new tasks** (e.g. `load_skill`,
  `scratchpad`, `spawn_subagent`) → interceptor. Leave `LocalExec` nil and
  register a `localInterceptor` in `agent/internal/loop/interceptors.go`.
  Interceptors mutate `Entry` directly; do not try to shoehorn this through
  the generic `LocalExec` signature.

## Required schema fields (tools.go)

```go
{
    Name:             "your_tool",
    Description:      "...",             // short — long-form goes in agent/internal/tools/descriptions/your_tool.md
    InputSchema:      json.RawMessage(`{ ... }`),
    RequiresApproval: true,              // writes and shell commands ALWAYS require approval
    LocalExec:        myExec,            // or nil for TS/interceptor
}
```

Approval policy: writes (`apply_diff`, file mutation), command execution
(`run_command`, `run_command_background`), and any state-changing tool **must**
set `RequiresApproval: true`. Pure reads do not.

## Output conventions

- Long-form description lives in `agent/internal/tools/descriptions/<name>.md`
  (loaded into the system prefix; counts toward the cached prefix budget).
- Shared output formatting rules: `agent/internal/prompts/_output_conventions.md`.
  Read it before you decide on result framing — header lines, truncation
  markers, the `<truncated: ...>` envelope all have conventions.

## Read/search-loop guard

If the new tool is a read or navigation tool (`read_file`-like), the loop's
per-task cache and `wireMessages()` elision both need to know about it.
See `agent/internal/loop/loop.go` — search for the existing list of
cache-keyed tools (`read_file`, `search`, `find_files`, `list_dir`,
symbol/index tools, `semantic_search`). New read-side tools should be
added there or the loop's guard won't elide their results and prompt
bloat will accumulate.

## Approvals batching

Multiple `RequiresApproval` tools in the same turn batch into a single
`tool.approveBatch` RPC. Do not introduce a parallel per-call `tool.approve`
path for new Go-side tools — it breaks the batched approval UX.

## System prompt update

The mode prompts (`code.md`, `architect.md`, `ask.md`, `debug.md` under
`agent/internal/prompts/`) currently lead with "search first, read narrowly."
If your tool changes that ordering or introduces a new primary verb, update
the relevant mode prompts and add a `docs/prompt-changelog.md` entry.

## Tests

- Unit-test pure logic separately from the loop (the `apply_diff` pattern in
  `src/tools/applyDiffEdits.ts` is the model — pure module + a thin wiring
  layer).
- For Go tools, table-driven tests under `agent/internal/tools/` with a
  temp workspace.
- For TS tools, vitest under `src/tools/`.
