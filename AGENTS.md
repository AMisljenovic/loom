# AGENTS.md

Instructions for AI coding agents (OpenAI Codex, Cursor, Aider, Jules, etc.)
working in this repository.

This file follows the [agents.md](https://agents.md) convention. The same
content applies regardless of which agent reads it; see `CLAUDE.md` for the
canonical, more detailed version that Claude Code reads.

## Project summary

A VS Code extension with a Go backend. Three layers:
- TypeScript extension host (`src/`)
- React webview (`webview-ui/`)
- Go agent binary (`agent/`)

Layers talk via JSON-RPC 2.0 (LSP framing) over stdio. See
`src/shared/protocol.ts` for the wire types.

## Setup

```bash
npm install
(cd webview-ui && npm install)
```

Go 1.22+ and Node 20+ required.

## Build

```bash
npm run build
```

This runs three sub-builds: the Go agent (current platform only;
`npm run build:agent:all` cross-compiles all), the webview, and the extension
bundle.

## Run

Open the repo in VS Code and press **F5** to launch an Extension Development
Host. Run **Loom: Set Anthropic API Key** or export `ANTHROPIC_API_KEY` first.

## Test

Every fix or implementation unit must include relevant unit tests. Run the
smallest focused test command while iterating, then the broader suite before
handoff:
- Go: `go test ./...` from `agent/`
- TS: `npm run test:ts`
- Full extension check: `npm run build`

## Code style

- TypeScript strict mode, no `any`
- Go: `gofmt`, `go vet ./...` before committing
- React: function components, hooks only

## Architectural rules

1. The agent loop lives in Go (`agent/internal/loop/`). Do not move it.
2. VS Code API calls live in TypeScript only. Go asks via RPC.
3. Shared types in `src/shared/protocol.ts`. Mirror in Go.
4. Webview has no business logic — it renders and forwards messages.
5. Approval UX shortcuts live host-side in `src/panel/ChatPanel.ts`.
   `loom.autoApprove` and `loom.alwaysAllow` are workspaceState keys; session
   bulk counters are in-memory only. The Go loop remains serial.
6. Loom's internal extension-agent RPC uses LSP `Content-Length` framing.
   External MCP stdio servers use newline-delimited JSON-RPC in
   `agent/internal/mcp/`; do not mix these codecs.
7. Agent modes are defined in `src/modes.ts` (TS side) and sent with each
   `task.start`. Per-mode system prompts live in `agent/internal/prompts/*.md`
   and are embedded in the Go binary via `embed.FS`. The Go loop remains
   stateless with respect to mode configuration.
8. Tools execute in parallel within a turn (errgroup, cap 8). Tools that
   require approval are batched into one `tool.approveBatch` RPC. Do not
   reintroduce per-call `tool.approve` for new Go-side tools. `RoleTool`
   messages must be appended in original call order so the LLM transcript is
   deterministic.
9. Workspace symbol index lives in `agent/internal/index/`. Tree-sitter
   extraction is gated by `//go:build cgo`; the non-CGO build returns empty
   symbol lists so the agent still works. Embeddings live in
   `agent/internal/embed/` (Ollama, Voyage). Vector store is SQLite at
   `<workspace>/.loom/index.db` via pure-Go `modernc.org/sqlite`.
10. Anthropic + OpenAI prompt caching depend on a byte-stable system-prompt +
    tools prefix. MCP tools are sorted by name in `Driver.registry()`; keep
    any new tool ordering deterministic.
11. Conversation sessions are owned by the TypeScript host. `SessionsIndex`
    lives in `workspaceState`; bulky per-session bodies live as JSON under
    `ExtensionContext.storageUri` with legacy `workspaceState` bodies migrated
    and cleared. The Go side is unchanged (already keyed by `conversationId`).
    Switching sessions must cancel any in-flight task first or streamed deltas
    land in the wrong session.
12. Webview theming uses `data-accent` / `data-density` / `data-theme`
    attributes on the root element, driven by a `themeConfig` `HostToWebview`
    message. `ChatPanel.ts` reads `loom.ui.accent`, `loom.ui.density`, and
    `loom.ui.themeBias` from VS Code settings and re-posts on
    `onDidChangeConfiguration` and `onDidChangeActiveColorTheme`.
13. Natural-language mode switches are parsed by shared code in
    `src/shared/modeIntent.ts`. The host owns persisted mode state; the webview
    may pre-apply the same parser for responsiveness.
14. Assistant Markdown rendering stays webview-only and sanitized. Store raw
    message text in session state; render Markdown without raw HTML.
14b. Read-side tools are search-first. `read_file` accepts optional
    `offset`/`limit` for narrow slices and soft-caps files over ~256 KB to
    the first 2000 lines when no `limit` is given. `find_files` (filename
    glob), `search` (regex content grep), and `list_dir` (single
    directory) cover the navigation cases. Tool descriptions and the
    Code/Architect/Ask mode prompts lead with "search first, read
    narrowly" — preserve that ordering when adding new read-side tools.
14c. `scratchpad` is per-conversation agent-private working memory.
    Persisted at `<workspace>/.loom/scratchpad/<conversationId>.md`
    with `read|write|append|clear` actions (64 KB cap). LocalExec is
    nil; the loop intercepts the call in `execOneTool` and dispatches
    to `execScratchpad`, which mutates `Entry.Scratchpad` alongside
    the on-disk file in `agent/internal/scratchpad/`. Body is lazy-
    loaded from disk on first call per Entry. Keep separate from
    `update_todos` (user-visible) and skills (curated static).

15. v0.1.4 sub-agents run in parallel within a turn. The built-in
    `research` preset is always available, exposed through `spawn_subagent`.
    Additional presets may be imported from `.loom/agents/`,
    `.claude/agents/`, or `.codex/agents/`. Multiple
    spawns emitted in one turn run concurrently through the same errgroup
    as other tools; each sub-agent is read-only, has isolated conversation
    state, and streams into its own webview sub-agent card. Depth, per-tree
    count, and tree token ceiling are enforced atomically inside
    `TaskRegistry.Register`. Per-turn cap is `subAgentMaxPerTurn=3`. Do not
    add fire-and-forget orchestration or sub-agent model routing without
    updating `SUBAGENTS.md`.
12b. The transcript is uniform-minimal: every tool call renders through one
    `ToolCardMinimal` (header + IN pane + OUT peek; click to expand). Do
    not re-introduce per-tool specialty body components. Assistant deltas
    are split on tool-call / question / progress boundaries so inter-tool
    prose becomes slim italic `intent-line` messages, and the last
    non-empty assistant message before `task.done` (reason `completed`)
    is tagged `kind: "summary"` and rendered as a Summary card. Promotion
    happens client-side in [webview-ui/src/App.tsx](webview-ui/src/App.tsx);
    no prompt-side change. `ToolCardMinimal` must not flex-shrink inside the
    scrollable `.thread`; keep the CSS/layout regression tests in
    `webview-ui/src/styles/components.test.ts` and
    `webview-ui/src/components/thread/ToolCardMinimal.test.tsx` aligned with
    any transcript UI changes.

13. First-run setup is host-owned state and webview-rendered UI. The
    `loom.firstRun.completed` **globalState** key gates the setup panel
    (with one-shot migration from the legacy workspaceState key), so the
    setup persists across all workspaces. `configurationTarget()` writes
    provider/model settings at `ConfigurationTarget.Global`; VS Code's
    standard settings cascade still lets a workspace `.vscode/settings.json`
    override globals. API keys still go through VS Code SecretStorage
    via `setSecret`. Four
    providers are exposed: `anthropic`, `openai`, `openai-compatible`, and
    `local`. Picking `openai-compatible` reveals a Preset dropdown
    (OpenRouter, Groq, Cerebras, Vercel AI Gateway, LM Studio, Generic) that
    pre-fills Base URL and the curated model list; presets are UI-only
    ([webview-ui/src/util/provider.ts](webview-ui/src/util/provider.ts)) and
    still collapse to `openai-compatible` on the wire. Models are editable
    combos (curated dropdown + `Other…` text input). The
    full-pane Settings view stores per-provider advanced options
    (max output tokens, context-window override, reasoning effort, custom
    HTTP headers) under `globalState["loom.llm.advanced"]` and ships
    them to Go via `ConfigUpdateParams` plus the spawn env
    (`OPENAI_MAX_OUTPUT_TOKENS`, `OPENAI_CONTEXT_WINDOW`,
    `OPENAI_CUSTOM_HEADERS`). On the wire `openai-compatible` collapses to
    `openai` with an explicit `BaseURL`.
14. Extension shutdown and update handling must cancel any active task, persist
    the active session, and dispose the Go process deliberately. Keep cleanup
    in `ChatPanel.dispose()` / `AgentClient.dispose()`.
15. Go task goroutines must recover panics, emit only sanitized opt-in
    telemetry metadata, notify the user with a generic error, and send
    `task.done` with reason `error`.
16. Marketplace assets live in `assets/` and `media/`. Do not regenerate them
    from code when exported brand files already exist.
17. Tool descriptions live in `agent/internal/tools/descriptions/*.md`, not in
    Go prose literals. Shared output conventions live in
    `agent/internal/prompts/_output_conventions.md`. Prompt changes require
    updating `docs/prompt-changelog.md` and running `npm run eval` when
    provider credentials are available.
18. Project rules are auto-loaded by `agent/internal/rules/` and frozen at task
    start. `.loomrules` is always loaded first and declared top-precedence in
    the prompt envelope. Provider-native files come next: CLAUDE.md +
    `.claude/rules/*.md` for Anthropic, AGENTS.md + `.codex/rules/*.md` for
    OpenAI, GEMINI.md + `.gemini/rules/*.md` for Gemini. Gemini family is
    detected from the model id (any model whose name starts with `gemini`,
    including `models/gemini-*`) regardless of which provider preset routed
    it. When the provider's native files are absent, a universal fallback
    chain picks up the other providers' files, then
    `.github/copilot-instructions.md`, `.github/instructions/*.md`,
    `.cursor/rules/*.md`, and `.cursorrules`, so Loom respects whichever
    convention the workspace already uses. The bundle is capped at 32 KB,
    deduped by content hash, and lives in the volatile tail of the system
    prompt.
19. Skills, sub-agents, and commands are auto-imported with the same
    provider-family convention. Loom-native config (`builtin` plus
    `.loom/<kind>/`) wins; `.loom/<kind>/` overrides builtins, builtins
    override external entries, and external entries are additive only.
    Anthropic loads `.claude/<kind>/`; OpenAI, OpenAI-compatible, and local
    providers load `.codex/<kind>/`; Gemini loads `.gemini/<kind>/`. The
    other providers' folders are consulted only when the family-native
    folder contributes zero entries.
20. `agent/internal/loop/maybeSummarize` must never cut mid-tool-batch.
    `safeCutBoundary` (`agent/internal/loop/summarize.go`) walks the cut
    back so the kept tail never begins with `RoleTool` and the summarized
    prefix never ends on an `assistant(tool_calls)` whose results live in
    the tail. OpenAI/Azure rejects either shape with
    `messages.[N].role: tool must be a response to a preceding message with
    tool_calls`.
21. Default per-task model/tool turn cap is 32 (`loop.go`). Continue on a
    `turn_limit` stop doubles the cap (32 → 64 → 128 → …): the stop card
    carries `maxTurns`, the Continue button posts `submit` with `maxTurns`
    doubled, the host forwards it via `TaskStartParams.maxTurns`, and
    `Driver.Run` reads it through `StartParams.MaxTurns`. Non-turn-limit
    stops (`error`, `cancelled`) omit `maxTurns` and resume at the
    default.
22. Transcript auto-follow lives in `Thread.tsx` and uses a
    `ResizeObserver` + `MutationObserver` to pin scrollTop whenever the
    container or any child grows, while the user is within 32 px of the
    bottom. The user-scroll detector is suppressed for one event after
    each programmatic pin so streaming layout shifts don't flip
    `stuckRef` off mid-conversation.

## Pre-commit hook

`npm install` installs a Husky pre-commit hook (`scripts/check-docs-sync.mjs`)
that blocks a commit when staged changes touch `src/`, `agent/`,
`webview-ui/src/`, `package.json`, `scripts/`, or `.github/workflows/` but
none of these repo-facing doc files are also staged:

- `README.md`
- `CLAUDE.md`
- `AGENTS.md`
- `.github/copilot-instructions.md`

Keep the relevant docs in sync: `README.md` for user-facing behavior and the
instruction files for agent-facing architecture. Bypass with
`SKIP_DOCS_CHECK=1 git commit ...` or `git commit --no-verify` when a doc
update is genuinely unnecessary.

## Pull request expectations

- One concern per PR
- Update `README.md` for user-facing behavior and `CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md` for architecture changes (enforced by pre-commit hook)
- Run `npm run build` clean
- Conventional commits (`feat:`, `fix:`, `chore:`, etc.)
