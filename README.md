# My Agent

VS Code AI coding agent. TypeScript extension shell + Go agent backend.

## Architecture

```
Webview (React) ─► extension.ts ─► Go agent binary
                   (proxy + VS Code API tools)   (loop + LLM + Go tools)
```

The Go binary is spawned as a child process and communicates over stdio
using JSON-RPC 2.0 (LSP-style framing).

## Build

Requires Node 20+ and Go 1.22+.

```bash
npm run install:all       # installs deps for root + webview
npm run build             # builds Go agent (current platform), webview, extension
```

Cross-platform: the build scripts use Node, so they work on Windows,
macOS, and Linux without bash. If something fails, see `TROUBLESHOOTING.md`.

This produces:
- `dist/extension.js` — bundled TS extension
- `dist/webview/` — webview React app
- `bin/agent-<platform>-<arch>` — Go binary for the current platform

To cross-compile binaries for all platforms (needed before packaging
release VSIX files):

```bash
npm run build:agent:all
```

## Run in dev

1. Open the folder in VS Code.
2. Press **F5** — this launches the Extension Development Host.
3. Run **Loom: Set Anthropic API Key** (or export `ANTHROPIC_API_KEY`).
4. Open the **My Agent** view in the activity bar.

## Package

```bash
npm run package           # produces a VSIX per platform in dist/
```

## Status

v0.1 scaffold. The Go agent loop is stubbed at `agent/internal/loop/loop.go` —
search for `TODO` to wire up the Anthropic streaming call.
