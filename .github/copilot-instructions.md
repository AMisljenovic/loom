# GitHub Copilot instructions

This file is read by GitHub Copilot Chat for context about this repository.
For full project documentation, see `CLAUDE.md`.

## What this project is

A VS Code extension with three runtimes:

- TypeScript extension host (`src/`)
- React webview (`webview-ui/`)
- Go agent binary (`agent/`)

Layers communicate via JSON-RPC 2.0 over stdio with LSP-style framing.
External MCP servers are a separate Go-side integration and use
newline-delimited JSON-RPC over stdio.

## Style

- TypeScript: strict mode, no `any`, prefer `unknown` + narrowing,
  `node:` prefix for built-ins, async/await
- Go: gofmt, `fmt.Errorf` with `%w` wrapping, channels over shared state,
  stderr for all logs, never stdout
- React: function components, hooks only, VS Code CSS variables for theming

## Where to put things

- Agent loop -> `agent/internal/loop/`
- MCP client/manager -> `agent/internal/mcp/`
- LLM SDK code -> `agent/internal/llm/`
- Go-side tools -> `agent/internal/tools/tools.go`
- Workspace symbol index -> `agent/internal/index/`
- Embeddings providers -> `agent/internal/embed/`
- Vector store -> `agent/internal/index/vector.go`
- Telemetry -> `agent/internal/telemetry/`
- TS-side tools -> `src/tools/index.ts`
- Wire types -> `src/shared/protocol.ts`
- Per-mode system prompts -> `agent/internal/prompts/*.md`
- Built-in mode definitions -> `src/modes.ts`
- Webview UI -> `webview-ui/src/`
- Webview design tokens -> `webview-ui/src/styles/tokens.css` and `components.css`
- Webview brand assets -> `webview-ui/src/brand/`
- Webview components -> `webview-ui/src/components/`
- Webview utilities -> `webview-ui/src/util/`
- Marketplace assets -> `assets/` and `media/`

## Rules

1. Agent loop stays in Go.
2. VS Code API calls stay in TypeScript.
3. Webview has no business logic.
4. Any wire-protocol change updates both sides in the same commit.
5. Approval UX shortcuts live host-side in `src/panel/ChatPanel.ts`.
   `loom.autoApprove` and `loom.alwaysAllow` are workspaceState keys; session
   bulk counters are in-memory only. The Go loop remains serial.
6. Keep the two stdio codecs separate: Loom's extension-agent bridge is
   LSP-framed, while MCP server stdio is newline-delimited JSON-RPC.
7. Tools run in parallel within a turn with approval-gated tools batched into
   one `tool.approveBatch` RPC. Do not add per-call `tool.approve` for new
   Go-side tools.
8. Prompt caching depends on a byte-stable system + tools prefix. Sort dynamic
   tool lists deterministically.
9. Conversation sessions are stored TS-side: the small `loom.sessions.index`
   stays in `workspaceState`, while bulky per-session bodies are JSON under
   `ExtensionContext.storageUri` with legacy workspaceState bodies migrated
   and cleared. Switching active sessions must cancel any in-flight task first.
9b. Transcript rendering is uniform-minimal: one `ToolCardMinimal` for every
    tool (label + IN/OUT panes; click to expand); inter-tool assistant
    prose splits into slim italic `intent-line` messages; the last
    assistant message of a completed turn is promoted to `kind: "summary"`
    and renders as a Summary card. Promotion is client-side in
    `webview-ui/src/App.tsx`. Do not add specialty per-tool body
    components or prompt-side summary scaffolding. `ToolCardMinimal` must keep
    `flex-shrink: 0` in the scrollable transcript so expanded output/args and
    approval controls are not clipped behind the composer; update
    `ToolCardMinimal.test.tsx` and `components.test.ts` with transcript UI
    changes.

10. First-run setup is host-owned and **global**: `loom.firstRun.completed`
    and `loom.llm.advanced` live in `globalState` (with one-shot migration
    from legacy workspaceState), and `configurationTarget()` writes
    provider/model VS Code settings at `ConfigurationTarget.Global`. The
    standard VS Code settings cascade still honors per-workspace overrides
    via `.vscode/settings.json`. API keys must still use VS Code
    SecretStorage. Providers are `anthropic`, `openai`, `openai-compatible`,
    and `local`. Picking `openai-compatible` reveals a Preset dropdown
    (OpenRouter, Groq, Cerebras, Vercel AI Gateway, LM Studio, Generic) that
    pre-fills Base URL and the curated model list; presets are UI-only and
    still collapse to `openai-compatible` on the wire.
    Models are editable combos; the Settings view stores per-provider
    advanced options (max output tokens, context window, reasoning effort,
    custom headers) under `globalState["loom.llm.advanced"]` and ships them to Go via
    `ConfigUpdateParams` and spawn env (`OPENAI_MAX_OUTPUT_TOKENS`,
    `OPENAI_CONTEXT_WINDOW`, `OPENAI_CUSTOM_HEADERS`). `openai-compatible`
    collapses to `openai` on the wire.
11. Extension shutdown/update cleanup must cancel active tasks, persist the
    session, and dispose the Go process explicitly.
12. Go task panics must recover with sanitized opt-in telemetry and generic
    user-facing errors only.
13. Use checked-in exported marketplace assets from `assets/` and `media/`;
    do not replace them with generated assets.
14. Natural-language mode switches are parsed by shared code in
    `src/shared/modeIntent.ts`. The host owns persisted mode state; the webview
    may pre-apply the same parser for responsiveness.
15. Assistant Markdown rendering stays webview-only and sanitized. Store raw
    message text in session state; render Markdown without raw HTML.
16. v0.1.4 sub-agents run in parallel within a turn. Only the built-in
    `research` preset exists, exposed through `spawn_subagent`. Multiple
    spawns emitted in one turn run concurrently through the same errgroup
    as other tools; each sub-agent is read-only, has isolated conversation
    state, and streams into its own webview sub-agent card. Depth, per-tree
    count, and tree token ceiling are enforced atomically inside
    `TaskRegistry.Register`. Per-turn cap is `subAgentMaxPerTurn=5`. Do not
    add custom presets, fire-and-forget orchestration, or sub-agent model
    routing without updating `SUBAGENTS.md`.
17. Tool descriptions live in `agent/internal/tools/descriptions/*.md`, shared
    output conventions live in `agent/internal/prompts/_output_conventions.md`,
    and prompt changes must update `docs/prompt-changelog.md`. Run
    `npm run eval` when provider credentials are available.
18. Every fix or implementation unit must include relevant unit tests. Run the
    smallest focused test command while iterating, then the broader suite
    before handoff (`go test ./...` from `agent/`, `npm run test:ts`, and
    `npm run build` when the extension surface is touched).
19. Project rules are auto-loaded by `agent/internal/rules/` and frozen at task
    start. `.loomrules` is always loaded first and declared top-precedence in
    the prompt envelope. Provider-native files are loaded next (CLAUDE.md +
    `.claude/rules/*.md` for Anthropic, AGENTS.md + `.codex/rules/*.md` for
    OpenAI). When the provider's native files are absent, a universal
    fallback chain picks up the opposite provider's files, then
    `.github/copilot-instructions.md`, `.github/instructions/*.md`,
    `GEMINI.md`, `.gemini/rules/*.md`, `.cursor/rules/*.md`, and
    `.cursorrules`, so Loom respects whatever convention the workspace
    already uses. The whole bundle is capped at 32 KB, deduped by content
    hash, and lives in the volatile tail of the system prompt.

## Pre-commit hook

A Husky pre-commit hook (`scripts/check-docs-sync.mjs`, installed by
`npm install`) blocks commits that touch `src/`, `agent/`, `webview-ui/src/`,
`package.json`, `scripts/`, or `.github/workflows/` without also staging one
of `README.md`, `CLAUDE.md`, `AGENTS.md`, or `.github/copilot-instructions.md`.
Keep `README.md` aligned with user-facing behavior and the instruction files
aligned with architecture. Bypass with `SKIP_DOCS_CHECK=1` or `--no-verify`
when no doc change is warranted.
