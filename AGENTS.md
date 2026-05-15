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
`scripts/build-agent.sh` cross-compiles all), the webview, and the extension
bundle.

## Run

Open the repo in VS Code and press **F5** to launch an Extension Development
Host. Run **Loom: Set Anthropic API Key** or export `ANTHROPIC_API_KEY` first.

## Test

No test suite yet. When adding one:
- Go: `go test ./...` from `agent/`
- TS: vitest

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

## Pre-commit hook

`npm install` installs a Husky pre-commit hook (`scripts/check-docs-sync.mjs`)
that blocks a commit when staged changes touch `src/`, `agent/`,
`webview-ui/src/`, `package.json`, `scripts/`, or `.github/workflows/` but
none of these three doc files are also staged:

- `CLAUDE.md`
- `AGENTS.md`
- `.github/copilot-instructions.md`

Keep them in sync. Bypass with `SKIP_DOCS_CHECK=1 git commit ...` or
`git commit --no-verify` when a doc update is genuinely unnecessary.

## Pull request expectations

- One concern per PR
- Update `CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md` if architecture changes (enforced by pre-commit hook)
- Run `npm run build` clean
- Conventional commits (`feat:`, `fix:`, `chore:`, etc.)
