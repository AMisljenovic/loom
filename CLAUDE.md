# CLAUDE.md

Project instructions for Claude Code working in this repository.

## What this project is

A VS Code extension that provides an AI coding agent. The architecture is split
across three runtimes:

1. **TypeScript extension host** (`src/`) — runs in VS Code's Node environment.
   Owns anything that touches the VS Code API: editor edits, terminal, diagnostics,
   webview lifecycle.
2. **React webview** (`webview-ui/`) — the chat UI. Built with Vite, rendered in
   a VS Code webview. Talks to the extension host via `postMessage` only.
3. **Go agent binary** (`agent/`) — spawned as a child process by the extension.
   Owns the agent loop, LLM client, and pure-Go tools (file I/O, search).
   Communicates with the extension over stdio using JSON-RPC 2.0 (LSP framing).
   It also owns MCP client connections to external stdio MCP servers.

The wire protocol between layers is defined in `src/shared/protocol.ts`. Any
change to a message type must be made on both sides.

## Architectural rules (do not violate without discussion)

- **Go owns the agent loop.** Do not move agent logic into TypeScript. The TS
  side is a proxy.
- **TS owns the VS Code API.** Do not try to call VS Code APIs from Go. If Go
  needs editor state, it asks via `tool.call` RPC.
- **Webview is dumb.** It renders state and forwards user input. No business
  logic, no LLM calls, no file system access.
- **Shared types live in `src/shared/protocol.ts`.** Mirror them in Go when
  needed; do not invent parallel type systems.
- **JSON-RPC framing is LSP-style** (`Content-Length` header + body). Do not
  switch the extension-agent bridge to newline-delimited JSON without updating
  both sides.
- **MCP stdio is separate.** External MCP servers use newline-delimited
  JSON-RPC in `agent/internal/mcp/`; do not reuse `agent/internal/rpc/`, which
  is only for Loom's internal LSP-framed bridge.
- **Parallel tools are the default.** Within a turn the loop dispatches all
  tool calls concurrently via `errgroup` (cap 8). Tools requiring approval
  are batched into one `tool.approveBatch` RPC; do not reintroduce per-call
  `tool.approve` for new Go-side tools. `RoleTool` messages are appended in
  original call order so the LLM sees a deterministic transcript.
- **Prompt prefix must stay byte-stable.** Anthropic and OpenAI prompt
  caching both rely on the system-prompt + tools prefix being identical
  across turns. The system prompt is split into a stable prefix (mode +
  tools + skills catalogue, built by `buildStableSystem`) and a volatile
  tail (workspace path + loaded-skill bodies + rules bundle, built by
  `buildVolatileSystem`). Anthropic places its `cache_control` breakpoint
  between the two blocks; OpenAI concatenates. When adding tools, ensure
  list order is deterministic (MCP tools are sorted by name in
  `Driver.registry()`). Never put per-turn-variable data in the stable
  prefix — it will break the cache.
- **Rules are auto-loaded, provider-aware, task-frozen.**
  `agent/internal/rules/` reads `.loomrules` always, plus `CLAUDE.md` +
  `.claude/rules/*.md` for Anthropic or `AGENTS.md` + `.codex/rules/*.md`
  for OpenAI. The bundle hash is captured on the conversation `Entry` at
  task start; mid-task file edits do not invalidate the running cache.
  Provider family is reported by `llm.Provider.Family()`.
- **Skills are advertised in the prefix, loaded on demand.** The catalogue
  (id + synopsis) sits in the stable prefix; bodies are injected into the
  volatile tail only after the model calls `load_skill`. Builtin skills
  live in `agent/internal/skills/builtin/*.md` (embed.FS); workspace
  skills live in `.loom/skills/<id>/SKILL.md`. `load_skill` is intercepted
  in the loop (not a regular `LocalExec`) because it mutates
  `conversation.Entry.LoadedSkills`.
- **Diagnostics feedback loop.** After a successful `apply_diff`, the TS
  side diffs pre/post-edit `vscode.languages.getDiagnostics` for affected
  URIs (750ms settle) and attaches new errors/warnings as a `followups`
  array on the `ToolResult`. The Go loop renders followups as a synthetic
  `<diagnostics-followup>` user message on the next turn. Quiet by default
  — clean edits emit nothing.
- **Background processes are TS-owned.** `run_command` stays one-shot
  (≤120s). For longer work, `run_command_background` /
  `read_process_output` / `kill_process` are dispatched in
  `src/tools/processes.ts` (a `ProcessManager` with a 256KB ring buffer
  per process, retained 5 min after exit). Process state never crosses
  into Go.
- **Indexer is optional.** Tree-sitter symbol extraction is gated by
  `//go:build cgo`. The non-CGO build path compiles fine and reports an
  empty index; `find_symbol` / `find_references` return "no matches".
  `semantic_search` only registers when `LOOM_EMBED_PROVIDER` is set.
- **Conversation sessions are multi-row.** TS keeps a `SessionsIndex` in
  `workspaceState["loom.sessions.index"]` plus one body per session under
  `loom.sessions.body:<id>`. The legacy `loom.conversation` single-state key
  is migrated on first load. The Go store ([agent/internal/conversation/](agent/internal/conversation/))
  was already keyed by `conversationId`, so multi-session is a TS+webview
  feature; do not add list-management logic in Go. Switching sessions
  cancels any in-flight task before swapping to avoid stream cross-talk.
- **Webview theming is data-attribute driven.** Three VS Code settings
  (`loom.ui.accent`, `loom.ui.density`, `loom.ui.themeBias`) are read by
  `ChatPanel.ts` and posted as a `themeConfig` `HostToWebview` message. The
  webview sets `data-accent`/`data-density`/`data-theme` on the root element;
  CSS token overrides cascade from there. VS Code theme class
  (`.vscode-dark`/`.vscode-light`) handles chrome; Loom owns accent+density.
- **Mode switching is host-owned.** Natural-language mode switches are parsed
  in shared code (`src/shared/modeIntent.ts`). The webview can pre-apply the
  parser for responsiveness, but `ChatPanel.ts` owns persisted mode state.
- **Markdown rendering is webview-only.** Session state stores raw assistant
  text. The webview renders safe Markdown without raw HTML.
- **Sub-agents run in parallel within a turn (v0.1.4).** The only built-in
  preset is `research`, exposed through `spawn_subagent`. Multiple
  `spawn_subagent` calls emitted in the same turn run concurrently through
  the standard `errgroup` (cap 8), each in an isolated conversation with a
  read-only tool allowlist, streaming into its own webview sub-agent card.
  Limits are enforced atomically inside `TaskRegistry.Register` (depth,
  per-tree count, tree token ceiling) — do not re-introduce pre-checks
  outside the registry. Per-turn cap stays at `subAgentMaxPerTurn=5`. Do
  not add custom presets, fire-and-forget orchestration, or sub-agent model
  routing without updating `SUBAGENTS.md`.
- **First-run setup is host-owned.** `ChatPanel.ts` stores
  `workspaceState["loom.firstRun.completed"]`, posts `firstRunState`, and
  keeps API keys on the existing SecretStorage path. The webview renders the
  setup panel and forwards provider/key choices only.
- **Shutdown is deliberate.** `ChatPanel.dispose()` cancels an active task,
  persists session state, clears pending approvals, and disposes
  `AgentClient`. Do not rely on VS Code process cleanup for update/reload
  behavior.
- **Go panics are sanitized.** Task goroutines recover panics, log the local
  stack to stderr, emit only bounded opt-in telemetry metadata, post a generic
  user-facing error, and finish with `task.done` reason `error`.
- **Marketplace assets are checked in.** Use `assets/` and `media/` for VSIX
  icon/demo assets. Do not introduce generated replacements when exported
  brand files already exist.
- **Prompt guidance is versioned and documented.** Tool descriptions live in
  `agent/internal/tools/descriptions/*.md`, shared output rules live in
  `agent/internal/prompts/_output_conventions.md`, and prompt behavior changes
  must update `docs/prompt-changelog.md`. Run `npm run eval` when provider
  credentials are available.

## Where things live

| Concern | Location |
|---|---|
| Extension activation | `src/extension.ts` |
| Go process spawn + RPC client | `src/agentClient.ts` |
| JSON-RPC codec (TS) | `src/rpc.ts` |
| Webview host + bridge | `src/panel/ChatPanel.ts` |
| TS-side tools | `src/tools/index.ts` |
| Wire types | `src/shared/protocol.ts` |
| Agent entrypoint | `agent/cmd/agent/main.go` |
| Agent loop | `agent/internal/loop/loop.go` |
| MCP client/manager | `agent/internal/mcp/` |
| Anthropic SDK wrapper | `agent/internal/llm/llm.go` |
| Tool registry | `agent/internal/tools/tools.go` |
| Workspace symbol index | `agent/internal/index/` (CGO tree-sitter when available, pure-Go fallback) |
| Embeddings providers | `agent/internal/embed/` (Ollama, Voyage) |
| Vector store (SQLite) | `agent/internal/index/vector.go` (writes to `<workspace>/.loom/index.db`) |
| Opt-in telemetry | `agent/internal/telemetry/` |
| Marketplace assets | `assets/`, `media/` |
| Per-mode system prompts | `agent/internal/prompts/*.md` (embedded via `embed.FS`) |
| Built-in mode definitions | `src/modes.ts` |
| JSON-RPC codec (Go) | `agent/internal/rpc/rpc.go` |
| Chat UI | `webview-ui/src/App.tsx` |
| Webview design tokens | `webview-ui/src/styles/tokens.css` |
| Webview component styles | `webview-ui/src/styles/components.css` |
| Webview brand assets | `webview-ui/src/brand/` (`LoomMark`, icons) |
| Webview components | `webview-ui/src/components/` (thread, toolbar, composer, popovers, conversations) |
| Webview utilities | `webview-ui/src/util/` (`format`, `rules`, `parseToolOutput`) |

## Build, run, test

```bash
# First-time setup
npm install
(cd webview-ui && npm install)

# Build everything
npm run build

# Watch mode for TS (re-run build:webview / build:agent manually as needed)
npm run watch

# Cross-compile Go for all targets
npm run build:agent:all

# Package per-platform VSIX
npm run package
```

To run in dev: open the repo in VS Code, press **F5**. This launches an
Extension Development Host with the extension loaded. Set
the **Loom: Set Anthropic API Key** command or export `ANTHROPIC_API_KEY` before
testing.

There is no automated test suite yet. When adding one, prefer:
- Go: standard `go test ./...`
- TS: vitest (lighter than jest for this size)
- Do not add Playwright/e2e until v0.2.

### Pre-commit hook

`npm install` runs Husky's `prepare` step, which installs `.husky/pre-commit`.
The hook runs `scripts/check-docs-sync.mjs`, which blocks a commit when staged
changes touch source/build areas (`src/`, `agent/`, `webview-ui/src/`,
`package.json`, `scripts/`, `.github/workflows/`) but none of the repo-facing
documentation files are also staged:

- `README.md`
- `CLAUDE.md`
- `AGENTS.md`
- `.github/copilot-instructions.md`

Keep the relevant docs in sync: `README.md` for user-facing behavior and the
three instruction files for agent-facing architecture. Bypass the check with
`SKIP_DOCS_CHECK=1 git commit ...` or `git commit --no-verify` when a change
genuinely needs no doc update (e.g. a typo fix in source).

## Conventions

**TypeScript:**
- Strict mode. No `any` unless interfacing with untyped JSON; prefer
  `unknown` + a narrowing check.
- Imports: node built-ins use `node:` prefix (`node:path`, not `path`).
- Async over callbacks. No `.then()` chains; use `await`.
- No default exports for modules with multiple exports; keep things named.

**Go:**
- Standard `gofmt`. Run `go vet ./...` before committing.
- Errors are values; wrap with `fmt.Errorf("context: %w", err)` not `errors.Wrap`.
- Concurrency: prefer channels over shared state. Every goroutine has a clear
  termination story.
- Keep SDK-specific types inside `internal/llm/`. The loop should not import
  the Anthropic SDK directly.

**React (webview):**
- Function components only. Hooks for state.
- No external state management library. `useState` + `useReducer` is enough.
- Inline styles use VS Code CSS variables (`var(--vscode-font-family)` etc.)
  so the UI matches the user's theme.

## What to do when asked to add a tool

1. Decide which side runs it. If it touches the VS Code API → TS. If it's pure
   computation or file I/O → Go.
2. Add the tool definition to `agent/internal/tools/tools.go`. Include
   `InputSchema` and set `RequiresApproval` appropriately (writes and
   command execution always require approval).
3. If Go-side: implement `LocalExec`.
4. If TS-side: leave `LocalExec` nil and add a case to the switch in
   `src/tools/index.ts`.
5. Update the system prompt the loop sends to the model so it knows the tool
   exists.

## What to do when asked to support a new LLM provider

Do not put provider branching in `loop.go`. Add an interface in
`agent/internal/llm/`, implement it per provider, inject the implementation
from `main.go`. Pattern after `text/template` style — small interface,
multiple implementations.

## Things to be careful about

- **Approval UX gate.** Approval short-circuits live host-side in
  `src/panel/ChatPanel.ts`: `loom.autoApprove` (now a category-based
  `AutoApproveConfig`, not a boolean — see `src/approval/categories.ts`),
  `loom.alwaysAllow`, and in-memory session counters are checked before
  creating a pending approval. Categories are `read | write | execute |
  mcp | mode | subtasks | question`; the legacy boolean shape migrates
  automatically. The toolbar pill (`auto-approve on` / `off`) opens the
  popover defined in `webview-ui/src/components/AutoApprovePopover.tsx`.
- **Cross-platform paths.** Use `filepath.Join` in Go and `path.join` from
  `node:path` in TS. Never string-concatenate paths.
- **Binary permissions.** On Unix, the bundled Go binary needs the executable
  bit. `agentClient.ts` does a `chmodSync(binary, 0o755)` on first run.
- **Webview CSP.** The webview has a strict Content-Security-Policy. Do not
  add inline scripts; bundle them through Vite.
- **stdio buffering.** Use the framed protocol; do not write plain JSON to
  stdout from Go or it will desync the extension-agent codec. Use `stderr` for
  logging. MCP child processes are the exception: their own stdio protocol is
  newline-delimited JSON and is handled only inside `agent/internal/mcp/`.

## When you finish a task

- Run `npm run build` to make sure everything compiles.
- For Go changes, run `go vet ./...` from `agent/`.
- Update this file if you change the architecture, not just the implementation.
