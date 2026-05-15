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
  stderr for all logs (never stdout)
- React: function components, hooks only, VS Code CSS variables for theming

## Where to put things

- Agent loop → `agent/internal/loop/`
- MCP client/manager → `agent/internal/mcp/`
- LLM SDK code → `agent/internal/llm/` (isolated; the loop never imports the SDK)
- Go-side tools → `agent/internal/tools/tools.go`
- Workspace symbol index → `agent/internal/index/` (tree-sitter via CGO when available, pure-Go fallback otherwise)
- Embeddings providers → `agent/internal/embed/` (Ollama, Voyage)
- Vector store (SQLite) → `agent/internal/index/vector.go` (`<workspace>/.loom/index.db`)
- Telemetry (opt-in) → `agent/internal/telemetry/`
- TS-side tools → `src/tools/index.ts`
- Wire types → `src/shared/protocol.ts` (mirror in Go)
- Per-mode system prompts → `agent/internal/prompts/*.md` (embedded via `embed.FS`)
- Built-in mode definitions → `src/modes.ts`
- Webview UI → `webview-ui/src/`

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
7. Tools run in parallel within a turn (errgroup, cap 8). Approval-gated
   tools are batched into one `tool.approveBatch` RPC — do not add per-call
   `tool.approve` for new Go-side tools.
8. Prompt caching (Anthropic cache_control, OpenAI automatic) depends on a
   byte-stable system + tools prefix. Sort any newly-added dynamic tool
   list deterministically.

## Pre-commit hook

A Husky pre-commit hook (`scripts/check-docs-sync.mjs`, installed by
`npm install`) blocks commits that touch `src/`, `agent/`, `webview-ui/src/`,
`package.json`, `scripts/`, or `.github/workflows/` without also staging one
of `CLAUDE.md`, `AGENTS.md`, or `.github/copilot-instructions.md`. Keep all
three in sync. Bypass with `SKIP_DOCS_CHECK=1` or `--no-verify` when no doc
change is warranted.
