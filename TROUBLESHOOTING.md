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

### First-run setup keeps asking for an API key

If you choose Anthropic or OpenAI, enter the key in the first-run panel or run
the matching command:

- **Loom: Set Anthropic API Key**
- **Loom: Set OpenAI API Key**

Keys are stored in VS Code SecretStorage. For development you can also use a
workspace `.env` file or process environment variables.

For local models, choose **Local** in the setup panel and confirm the base URL
and model. The default endpoint is `http://localhost:11434/v1`.

### "Agent binary not found at ..."

The binary for your current platform hasn't been built. Run
`npm run build:agent`.

### "Run Loom: Set Anthropic API Key or set ANTHROPIC_API_KEY"

The extension needs an API key. Either:
- Run **Loom: Set Anthropic API Key**, or
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

### "The Loom agent hit an internal error"

The Go backend recovered from a panic and stopped the current task. If
`loom.telemetry.enabled` is off, no event is sent. If it is on, Loom emits only
bounded metadata such as error kind and location; it does not send prompts,
file contents, workspace paths, API keys, or raw machine IDs.

Check the Extension Host logs and the VS Code developer console for the local
stack trace, then file a bug with the extension version, platform, and the
redacted log.

## Install and packaging issues

### macOS says the agent binary cannot be opened

The v1.0 VSIX bundles unsigned Go binaries. If Gatekeeper blocks the agent
after installing a local or GitHub Release VSIX, remove the quarantine flag
from the extension install directory:

```bash
xattr -dr com.apple.quarantine ~/.vscode/extensions/loom-dev.loom-*
```

Then reload VS Code. Marketplace builds should eventually be signed and
notarized; v1.0 documents this workaround instead.

### Windows SmartScreen warns about the binary

The v1.0 Windows binary is not EV-signed. For local VSIX installs, choose
**More info** and **Run anyway** only if the VSIX came from your own build or
the official project release. EV signing is deferred from v1.0.

### A VSIX contains binaries for other platforms

Use `npm run package`, not a direct `vsce package` command. The packaging
script cross-compiles all five binaries, temporarily stages one target binary
at a time, and writes per-platform VSIX files.

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
  development this usually is not an issue because you built it yourself; for
  distributed VSIX, use the quarantine workaround above until signing and
  notarization are added.

### Linux

- The bundled binary needs the executable bit. `agentClient.ts` does this
  automatically on first activation, but if you're testing the binary
  directly, `chmod +x bin/agent-linux-x64`.
