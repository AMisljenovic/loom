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
  switch to newline-delimited JSON without updating both sides.

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
| Anthropic SDK wrapper | `agent/internal/llm/llm.go` |
| Tool registry | `agent/internal/tools/tools.go` |
| JSON-RPC codec (Go) | `agent/internal/rpc/rpc.go` |
| Chat UI | `webview-ui/src/App.tsx` |

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
bash scripts/build-agent.sh

# Package per-platform VSIX
bash scripts/package.sh
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
`package.json`, `scripts/`, `.github/workflows/`) but none of the three
AI-agent instruction files are also staged:

- `CLAUDE.md`
- `AGENTS.md`
- `.github/copilot-instructions.md`

Keep all three in sync — they are mirrors aimed at different agents. Bypass
the check with `SKIP_DOCS_CHECK=1 git commit ...` or `git commit --no-verify`
when a change genuinely needs no doc update (e.g. a typo fix in source).

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

- **Cross-platform paths.** Use `filepath.Join` in Go and `path.join` from
  `node:path` in TS. Never string-concatenate paths.
- **Binary permissions.** On Unix, the bundled Go binary needs the executable
  bit. `agentClient.ts` does a `chmodSync(binary, 0o755)` on first run.
- **Webview CSP.** The webview has a strict Content-Security-Policy. Do not
  add inline scripts; bundle them through Vite.
- **stdio buffering.** Use the framed protocol; do not write plain JSON to
  stdout from Go or it will desync the codec. Use `stderr` for logging.

## When you finish a task

- Run `npm run build` to make sure everything compiles.
- For Go changes, run `go vet ./...` from `agent/`.
- Update this file if you change the architecture, not just the implementation.
