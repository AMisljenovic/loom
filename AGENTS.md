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
Host. Set `myAgent.anthropicApiKey` or export `ANTHROPIC_API_KEY` first.

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

## Pull request expectations

- One concern per PR
- Update `CLAUDE.md` / `AGENTS.md` if architecture changes
- Run `npm run build` clean
- Conventional commits (`feat:`, `fix:`, `chore:`, etc.)
