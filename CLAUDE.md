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
  tools + skills catalogue, built by `BuildStableSystem`) and a volatile
  tail (workspace path + loaded-skill bodies + rules bundle, built by
  `BuildVolatileSystem`). Both Anthropic and OpenAI adapters send these as
  separate system blocks so the cached prefix matches across turns even
  when the volatile tail shifts. Anthropic places explicit `cache_control`
  breakpoints; OpenAI relies on automatic prefix-based caching. When
  adding tools, ensure list order is deterministic (MCP tools are sorted
  by name in `Driver.registry()`). Never put per-turn-variable data in the
  stable prefix — it will break the cache.
- **Project context is Loom-only.** `agent/internal/rules/` reads
  `.loomrules` and nothing else. `agent/internal/skills/` and
  `agent/internal/loop/preset.go` read `.loom/skills/` and `.loom/agents/`
  (plus builtins). `src/commands/loader.ts` reads `.loom/commands/`.
  Foreign-format files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.claude/`,
  `.codex/`, `.gemini/`, `.cursor/`, `.cursorrules`,
  `.github/copilot-instructions.md`, `.github/instructions/`) are not
  loaded — keeping the prompt prefix smaller and tools/provider-neutral.
  The rules bundle hash is captured on the conversation `Entry` at task
  start; mid-task file edits do not invalidate the running cache.
- **Tool results are elided on the wire.** The conversation `Entry`
  retains every tool result verbatim so the webview transcript can show
  full output. Before each LLM call, `wireMessages()` in
  [agent/internal/loop/loop.go](agent/internal/loop/loop.go) keeps the latest
  full result for every exact read/navigation input and keeps all write/state
  tool outputs full. It may replace only older duplicate read/navigation
  results with a marker that points to the later retained `tool_call_id`.
- **Read/search loops are guarded per task.** The loop keeps a per-task cache
  for exact duplicate read/navigation calls (`read_file`, `search`,
  `find_files`, `list_dir`, symbol/index tools, `semantic_search`) and returns
  cached output instead of hitting disk again. Code/Debug tasks stop with an
  error and tool-count metadata if they cross the read/search guard without
  attempting `apply_diff`.
- **Skills are advertised in the prefix, loaded on demand.** The catalogue
  (id + synopsis) sits in the stable prefix; bodies are injected into the
  volatile tail only after the model calls `load_skill`. Builtin skills
  live in `agent/internal/skills/builtin/*.md` (embed.FS); workspace
  skills live in `.loom/skills/<id>/SKILL.md`. `load_skill` is intercepted
  in the loop (not a regular `LocalExec`) because it mutates
  `conversation.Entry.LoadedSkills`.
- **Search-first, read narrowly.** `read_file` accepts optional
  `offset`/`limit` (1-based line window) and soft-caps files over ~256 KB
  to the first 2000 lines when no `limit` is given — the header line
  reports the window and whether more remains. `find_files` exists for
  filename-pattern (glob) lookups; `search` is the content-grep tool;
  `list_dir` is for single-directory inspection. Tool descriptions and
  mode prompts (`code.md`, `architect.md`, `ask.md`) all lead with
  "search first, read narrowly" — keep that ordering when adding new
  read-side tools.
- **`apply_diff` supports two edit shapes.** Each `edits` entry is either
  an anchor edit `{oldText, newText}` (exact, unique string match) or a
  range edit `{startLine, endLine, newText}` (1-based inclusive line
  range; `endLine = startLine - 1` means pure insert). Pure logic lives in
  [src/tools/applyDiffEdits.ts](src/tools/applyDiffEdits.ts) so it can be
  unit-tested without the VS Code layer; [src/tools/index.ts](src/tools/index.ts)
  wires it to `WorkspaceEdit`. Within one call, range edits apply first in
  descending `startLine` order so earlier line numbers stay valid; anchor
  edits apply to the resulting buffer. On any anchor failure, the
  recovery error in [src/tools/applyDiffRecovery.ts](src/tools/applyDiffRecovery.ts)
  steers the model to a range edit — **never** to a whole-file rewrite.
  Keep that recovery contract intact when changing the schema.
- **Scratchpad is agent-private working memory.** The `scratchpad` tool
  stores a single per-conversation markdown buffer at
  `<workspace>/.loom/scratchpad/<conversationId>.md` with
  `read|write|append|clear` actions and a 64 KB cap. It follows the
  `load_skill` pattern: `LocalExec: nil` in
  [agent/internal/tools/tools.go](agent/internal/tools/tools.go), intercepted
  in the loop's `execOneTool` dispatch ([loop.go](agent/internal/loop/loop.go))
  by `execScratchpad`, which mutates `Entry.Scratchpad` + the on-disk file
  via the [scratchpad package](agent/internal/scratchpad/scratchpad.go). The
  body is lazy-loaded from disk on first call per Entry (the
  `ScratchpadLoaded` guard on `Entry`) so a resumed conversation picks up
  prior notes. Distinct from `update_todos` (user-visible progress) and
  skills (curated static knowledge) — do not collapse them.
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
- **Conversation sessions are multi-row and workspace-scoped.** TS keeps a
  small `SessionsIndex` in `workspaceState["loom.sessions.index"]`; bulky
  per-session bodies are JSON files under `ExtensionContext.storageUri`.
  When `storageUri` is unavailable (folderless windows, very early activation)
  bodies are written to `globalStorageUri/fallback-sessions/<fingerprint>/`
  — never back into `workspaceState`, which would alias all folderless
  windows together. The index carries a `workspaceFingerprint` (16-char SHA-1
  of `workspaceFile`/first folder URI/`"no-folder"`), and `loadSessions()`
  discards any saved index whose fingerprint differs from the active
  workspace's. Legacy `loom.sessions.body:<id>` workspaceState bodies and
  the `loom.conversation` single-state key are migrated and cleared. The Go
  store ([agent/internal/conversation/](agent/internal/conversation/)) was
  already keyed by `conversationId`, so multi-session is a TS+webview
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
- **Open-in-editor uses a virtual document scheme.** `src/tools/openInEditor.ts`
  registers a `loom-doc:` `TextDocumentContentProvider`. The webview posts
  `openInEditor` with `{ id, title, content, language? }`; the host opens a
  read-only editor tab through `vscode.workspace.openTextDocument` +
  `vscode.window.showTextDocument`. Wired into `ToolCardMinimal`'s expanded
  output pane, `IntentLine`, and `SummaryCard` — not into tool input args,
  error cards, or user messages. Content lives only in memory for the
  panel's lifetime.
- **Transcript is minimal-by-design.** Every tool call renders through a
  single uniform `ToolCardMinimal` (header = friendly label + short
  description, IN pane = one-line input summary, OUT pane = first ~3 lines
  truncated; click to expand). Do not re-introduce per-tool specialty body
  components. Assistant deltas are split on tool-call / question / progress
  boundaries — each chunk of inter-tool prose becomes a low-key reasoning
  card (`intent-line` — quiet card chrome, normal weight, non-italic, with
  a small "Reasoning" tag). The last non-empty assistant message before
  `task.done` with `reason === "completed"` is promoted to `kind: "summary"`
  and renders as a Summary card. Inline progress notes are hidden in the
  transcript — they're surfaced through the composer's live-status pill.
  The promotion logic lives in [webview-ui/src/App.tsx](webview-ui/src/App.tsx),
  not in Go; do not add prompt-side machinery to make summaries explicit.
  `ToolCardMinimal` must reserve its full height inside the scrollable
  transcript (`flex-shrink: 0`) so expanded output/args and approval controls
  are never clipped behind the composer. Keep the component and CSS regression
  tests in `webview-ui/src/components/thread/ToolCardMinimal.test.tsx` and
  `webview-ui/src/styles/components.test.ts` updated with transcript UI
  changes.
- **Transcript auto-follow uses a ResizeObserver, not a length effect.**
  `Thread.tsx` watches the thread container and its children with a
  ResizeObserver + MutationObserver and pins `scrollTop = scrollHeight` on
  every size change while the user is stuck within 32 px of the bottom.
  The user-scroll detector is suppressed for one event after each
  programmatic pin so a streaming layout shift can't flip `stuckRef` off
  and stall auto-follow. Do not revert to keying the scroll effect on
  `[messages, pendingOutputs]` — late markdown/code rendering grows
  content after React commit and the old approach falls behind.
- **Turn limit doubles per Continue.** Default cap is 32 model/tool turns
  (`loop.go`). When a task stops with `reason="turn_limit"`, the stop card
  carries the cap that was hit (`Msg.maxTurns`) and the Continue button
  sends a `submit` with `maxTurns` doubled (32 → 64 → 128 → …) via
  `nextTurnLimit` in `webview-ui/src/components/thread/Thread.tsx`. The
  host forwards it to `TaskStartParams.maxTurns`; the Go loop uses it
  through `runOptions.MaxTurns`. Non-turn-limit stops (`error`,
  `cancelled`) omit `maxTurns` and Continue uses the default.
- **Sub-agents run in parallel within a turn (v0.1.4).** Built-in
  `research`, `review`, `test-scout`, and `architecture-mapper` presets
  are exposed through `spawn_subagent`. `review` is read-only and
  parent-facing for implementation critique; `test-scout` is read-only
  and parent-facing for test coverage triage; `architecture-mapper` is
  read-only and parent-facing for structural scoping (layers, public
  surface, import edges, cycles) of a named target tree before a
  refactor. Multiple
  `spawn_subagent` calls emitted in the same turn run concurrently through
  the standard `errgroup` (cap 8), each in an isolated conversation with a
  read-only tool allowlist, streaming into its own webview sub-agent card.
  Limits are enforced atomically inside `TaskRegistry.Register` (depth,
  per-tree count, tree token ceiling) — do not re-introduce pre-checks
  outside the registry. Per-turn cap stays at `subAgentMaxPerTurn=3`. Custom
  presets may be added under `.loom/agents/`; do not add fire-and-forget
  orchestration or sub-agent model routing without updating `SUBAGENTS.md`.
- **First-run setup is host-owned and global.** `ChatPanel.ts` stores
  `globalState["loom.firstRun.completed"]` and
  `globalState["loom.llm.advanced"]`, posts `firstRunState`, and keeps API
  keys on the existing SecretStorage path. `configurationTarget()` always
  writes provider/model VS Code settings at `ConfigurationTarget.Global`.
  Workspace overrides remain possible — the standard VS Code settings
  cascade lets `.vscode/settings.json` shadow user-level Loom settings.
  Legacy `workspaceState` keys are migrated to `globalState` on activation.
  The webview renders the setup panel and forwards provider/key choices only.
- **Providers are flexible.** Four providers are exposed in the UI:
  `anthropic`, `openai`, `openai-compatible`, and `local` (Ollama preset).
  Picking `openai-compatible` reveals a Preset dropdown (OpenRouter, Groq,
  Cerebras, Google AI Studio (Gemini), Vercel AI Gateway, LM Studio,
  Generic) that pre-fills Base URL and the curated model list; presets are a
  UI-only concept in
  [webview-ui/src/util/provider.ts](webview-ui/src/util/provider.ts) — on
  the wire every preset still collapses to `openai-compatible` with an
  explicit BaseURL. First Run and Settings surface a provider- or
  preset-specific "Open … Console" button that sends the user to the
  provider's official key page so they can sign in there, create a key, and
  paste it back. Model fields are combo-style — a curated dropdown plus an
  `Other…` text input so any model id can be typed. The
  full-pane Settings view
  ([webview-ui/src/components/SettingsView.tsx](webview-ui/src/components/SettingsView.tsx))
  exposes Advanced fields — max output tokens, context-window override,
  reasoning effort, custom HTTP headers — stored per-provider in
  `workspaceState["loom.llm.advanced"]` and shipped to Go through
  `ConfigUpdateParams` (and on first spawn via
  `OPENAI_MAX_OUTPUT_TOKENS`, `OPENAI_CONTEXT_WINDOW`,
  `OPENAI_CUSTOM_HEADERS` JSON). API keys for `openai-compatible` live in
  SecretStorage under `loom.secret.openaiCompatibleApiKey`. On the wire to
  Go, `openai-compatible` collapses to the `openai` provider with an
  explicit `BaseURL` — there is no parallel agent-side branch.
- **OpenAI Responses API is an opt-in transport for reasoning models.**
  When `AdvancedLlmOptions.useResponsesAPI` is true (or
  `OPENAI_USE_RESPONSES=1`), the adapter routes calls for gpt-5*/o3*/
  o4*/o5* models through `/v1/responses` instead of `/v1/chat/completions`.
  Subsequent turns chain via `previous_response_id` so reasoning state
  stays server-side instead of being re-billed every turn. The loop
  tracks the chain anchor on `conversation.Entry.LastResponseID` +
  `LastResponseConsumedCount` ([conversation/store.go](agent/internal/conversation/store.go))
  and tags the LLM context with `llm.WithResponsesChain` before each
  call. The adapter ([agent/internal/llm/responses.go](agent/internal/llm/responses.go))
  builds `ResponseNewParams` with full history on first call (and full
  `instructions`) but only the **delta** (`messages[deltaStart:]`) on
  chained calls, omitting `instructions`. Tools are re-sent every call
  because the registry may change mid-task. The chain is reset on
  `maybeSummarize`, `HealOrphanToolCalls`, `Store.Hydrate`, and
  `Store.Reset` so the local history and server view never desync. On
  any 404 (endpoint unavailable) or 400 referencing
  `previous_response_id` (server lost the chain), the adapter flips a
  sticky `responsesFallback` flag and routes the rest of the provider
  session through Chat Completions. `openai-compatible` providers
  always use Chat Completions because their `/v1/responses` support is
  inconsistent.
- **Reasoning effort is per-mode, not just global.** `ModeDefinition`
  carries an optional `reasoningEffort` ([src/shared/protocol.ts](src/shared/protocol.ts),
  mirrored in [agent/internal/loop/loop.go](agent/internal/loop/loop.go)).
  Built-in modes ship sensible defaults — Code / Ask / Debug → `low`,
  Architect → `medium`, built-in read-only sub-agent presets → `low` —
  so trivial follow-up turns don't inherit the global Advanced "high"
  setting. The loop tags the LLM `ctx` with `llm.WithReasoningEffort`
  before each `Stream` call; the OpenAI adapter's
  `resolveReasoningEffort` ([agent/internal/llm/openai.go](agent/internal/llm/openai.go))
  prefers the per-call override, falling back to the provider default.
  User-authored `.loom/agents/*.md` presets may opt in via a
  `reasoning_effort: low|medium|high` frontmatter key. Custom modes
  declared under `loom.modes` may also set `reasoningEffort`.
  `ModelContextLimit` ([agent/internal/llm/limits.go](agent/internal/llm/limits.go))
  now falls back to 400K for any `gpt-5*` / `gpt-6*` / `o5*` variant
  rather than the 200K default, so unrecognized future models don't
  trigger over-aggressive summarization.
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
| Local-state-mutating tool interceptors | `agent/internal/loop/interceptors.go` (load_skill, scratchpad, spawn_subagent) |
| Project rules loader (`.loomrules`) | `agent/internal/rules/rules.go` |
| Workspace skills + builtins | `agent/internal/skills/` |
| Sub-agent presets (builtin + `.loom/agents/`) | `agent/internal/loop/preset.go` |
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

Every fix or implementation unit must include relevant unit tests. Run the
smallest focused test command while iterating, then the broader suite before
handoff:
- Go: standard `go test ./...`
- TS: `npm run test:ts` (vitest)
- Full extension check: `npm run build`
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
3. If Go-side: implement `LocalExec`. Its signature is
   `func(ctx context.Context, workspaceRoot string, input json.RawMessage) (string, error)`
   — honour `ctx` for any long-running work (network calls, large
   walks) so a user cancel propagates. Pure synchronous file ops may
   ignore it.
4. If TS-side: leave `LocalExec` nil and add a case to the switch in
   `src/tools/index.ts`.
5. If the tool needs to mutate conversation state (like `load_skill` or
   `scratchpad`) or fan out new tasks (like `spawn_subagent`), leave
   `LocalExec` nil and register a `localInterceptor` in
   `agent/internal/loop/interceptors.go` — that's how the existing
   three state-mutating tools are dispatched without expanding the
   generic `LocalExec` signature.
6. Update the system prompt the loop sends to the model so it knows the tool
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
- **Summarization must not cut mid-tool-batch.** `maybeSummarize` in
  `agent/internal/loop/loop.go` uses `safeCutBoundary` (in
  `agent/internal/loop/summarize.go`) to walk the proposed cut back so the
  kept tail never starts with `RoleTool` and the summarized prefix never
  ends on an `assistant(tool_calls)` whose results live in the tail.
  OpenAI/Azure rejects either shape with `messages.[N].role: tool must be
  a response to a preceding message with tool_calls`. If you change the
  compaction policy, preserve both invariants.
- **Continue must heal interrupted tool batches.** `Entry.HealOrphanToolCalls`
  in `agent/internal/conversation/` repairs assistant `tool_calls` that are
  missing one or more following `RoleTool` responses, and `Driver.run` calls it
  before streaming each new task. Keep that in-memory repair aligned with the
  persisted hydrate repair so cancellation, reload, or interruption mid-batch
  cannot poison the next OpenAI/Azure request.
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
