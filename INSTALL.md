# Installing Loom Code

Loom Code is a VS Code extension with a bundled Go agent binary. Today the
recommended install path is a per-platform VSIX from GitHub Releases or from a
local `npm run package` build.

## Requirements

- VS Code 1.90 or newer
- A Loom VSIX matching your operating system and CPU architecture
- One model provider:
  - Anthropic API key
  - OpenAI API key
  - OpenAI-compatible provider key and base URL
  - Local OpenAI-compatible server such as Ollama or LM Studio

For development builds, you also need Node 20+ and Go 1.22+.

## Pick the Right VSIX

Use the package that matches the machine where VS Code runs:

| Platform | Package |
| --- | --- |
| macOS Apple Silicon | `loom-darwin-arm64.vsix` |
| macOS Intel | `loom-darwin-x64.vsix` |
| Linux ARM64 | `loom-linux-arm64.vsix` |
| Linux x64 | `loom-linux-x64.vsix` |
| Windows x64 | `loom-win32-x64.vsix` |

The VSIX contains only the Go agent binary for that target platform.

## Install from a VSIX

Download the matching VSIX from the GitHub Release, then install it with the
VS Code command line:

```bash
code --install-extension path/to/loom-win32-x64.vsix
```

For a local package build from this repo:

```bash
npm run install:all
npm run package
code --install-extension dist/loom-win32-x64.vsix
```

Replace `loom-win32-x64.vsix` with the package for your platform.

You can also install from the VS Code UI:

1. Open Extensions.
2. Open the `...` menu.
3. Choose **Install from VSIX...**.
4. Select the Loom Code VSIX.
5. Reload VS Code when prompted.

## First Run

Open the Loom activity bar view, then choose a provider in the setup panel.
The setup is global, so new workspaces reuse the same provider and model unless
the workspace overrides them.

### Anthropic

Choose **Anthropic**, enter your API key, and pick a Claude model. Keys are
stored in VS Code SecretStorage.

You can also run:

```text
Loom: Set Anthropic API Key
```

### OpenAI

Choose **OpenAI**, enter your API key, and pick an OpenAI model. The OpenAI
base URL can be left empty for the default API or set to a custom endpoint.

You can also run:

```text
Loom: Set OpenAI API Key
```

### More Providers

Choose **More Providers** for an OpenAI-compatible endpoint. Presets are
available for OpenRouter, Groq, Cerebras, Vercel AI Gateway, and LM Studio.
Use **Generic** for Azure OpenAI, vLLM, self-hosted gateways, or any other
OpenAI-compatible API.

Fill in:

- API key, unless your endpoint does not require one
- Base URL
- Model ID

### Local

Choose **Local** for a local OpenAI-compatible server. The default base URL is:

```text
http://localhost:11434/v1
```

That works with Ollama's OpenAI-compatible endpoint when the server is running.
LM Studio can also be used through **More Providers** or by setting its local
base URL manually.

## Advanced Model Settings

Open the model popover from the toolbar, then open **Advanced settings...** to
configure:

- max output tokens
- context-window override
- reasoning effort for OpenAI and OpenAI-compatible providers
- custom HTTP headers

Advanced settings are stored globally under Loom's extension state and sent to
the Go agent at task start.

## Workspace Overrides

Global setup is the default. To override Loom for one project, edit that
workspace's `.vscode/settings.json`.

Example:

```json
{
  "loom.provider": "openai-compatible",
  "loom.openaiCompatible.baseUrl": "https://api.groq.com/openai/v1",
  "loom.openaiCompatible.model": "llama-3.3-70b-versatile"
}
```

VS Code's normal settings cascade applies, so workspace settings shadow user
settings.

## MCP Servers

Loom reads MCP server configuration from:

- `.vscode/mcp.json`
- `loom.mcp.servers` in VS Code settings
- the user MCP config directory

Example workspace config:

```json
{
  "servers": {
    "fs": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"]
    }
  }
}
```

MCP tools appear in the chat transcript like built-in tools and require
approval unless your approval policy allows them.

## Unsigned Binary Notes

Release VSIX files currently bundle unsigned Go binaries.

- On macOS, Gatekeeper may block the agent binary. The workaround is documented
  in [TROUBLESHOOTING.md](TROUBLESHOOTING.md#macos-says-the-agent-binary-cannot-be-opened).
- On Windows, SmartScreen may warn about the binary. Only continue for VSIX
  files you built yourself or downloaded from the official project release.

## Common Fixes

If the extension activates but cannot find the agent binary, install the VSIX
for your platform or rebuild the current-platform agent:

```bash
npm run build:agent
```

If the webview is blank in a development build:

```bash
npm run build:webview
```

If setup keeps asking for a key, use the first-run panel or one of the key
commands, then reload VS Code.

More fixes live in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
