# Troubleshooting

## Setup errors

### `'vite' is not recognized` or `Cannot find package 'esbuild'`

You haven't installed dependencies yet. Run:

```bash
npm install
npm --prefix webview-ui install
```

Or use the shortcut:

```bash
npm run install:all
```

The webview is a separate npm project, so it has its own `package.json` and
needs its own `npm install`.

### `go: command not found`

Go isn't installed or isn't on PATH.

- **Windows:** Install from https://go.dev/dl/ (the MSI installer adds it to
  PATH automatically), then open a **new** terminal window. PATH only refreshes
  for new shells.
- **macOS:** `brew install go`
- **Linux:** Use your package manager (`apt install golang-go`, `dnf install golang`)
  or download from https://go.dev/dl/.

Verify with `go version`.

### `bash: command not found` (Windows)

The old build scripts were bash-only. The current ones use Node and work on
Windows natively:

```bash
npm run build:agent      # current platform only (dev)
npm run build:agent:all  # all platforms (release)
```

If you still see references to `bash scripts/build-agent.sh`, you have an old
README. The `.sh` script is kept for Unix users; Windows uses `build-agent.mjs`
or `build-agent.ps1`.

## Build errors

### `error TS2307: Cannot find module 'vscode'`

Run `npm install` in the repo root — `@types/vscode` lives in the root
`package.json`, not the webview's.

### Go binary builds but the extension can't find it

Check the filename. `agentClient.ts` looks for
`bin/agent-${process.platform}-${process.arch}${ext}`, e.g.
`bin/agent-win32-x64.exe` on Windows. The build script renames Go's `amd64`
to Node's `x64` automatically — if you see `agent-windows-amd64.exe` instead
of `agent-win32-x64.exe`, the rename step failed. Re-run the build.

## Runtime errors

### "Agent binary not found at ..."

The binary for your current platform hasn't been built. Run
`npm run build:agent`.

### "Set myAgent.anthropicApiKey or ANTHROPIC_API_KEY"

The extension needs an API key. Either:
- Set `myAgent.anthropicApiKey` in VS Code settings, or
- Export `ANTHROPIC_API_KEY` before launching VS Code

The env var is read at the time the extension activates, not at task start,
so you may need to restart VS Code after setting it.

### Extension activates but webview is blank

Run `npm run build:webview`. The webview is a separate build and isn't
triggered by `build:ts`.

### JSON-RPC desync ("Unexpected token in JSON" or similar)

Something is writing unframed bytes to the Go process's stdout. The fix is
always: find the stray `fmt.Print*` or `println` in Go code and change it to
`log.Print*` (which goes to stderr). See `.cursor/rules/wire-protocol.mdc`.

## Platform-specific notes

### Windows

- PowerShell uses `;` as a command separator, not `&&` (cmd.exe accepts both).
  Inside `npm run` scripts both work because npm spawns its own shell.
- If a script copy-paste includes a leading `>` or `$`, that's the prompt
  symbol from documentation, not part of the command. Strip it.
- File paths in PowerShell use `\`, but npm scripts and Go code expect
  forward slashes inside string literals. Stick to forward slashes in code.

### macOS

- Unsigned Go binaries get blocked by Gatekeeper on first run. For local
  development this isn't an issue because you built it yourself; for
  distributed VSIX, sign + notarize. See
  `.claude/agents/release-engineer.md`.

### Linux

- The bundled binary needs the executable bit. `agentClient.ts` does this
  automatically on first activation, but if you're testing the binary
  directly, `chmod +x bin/agent-linux-x64`.
