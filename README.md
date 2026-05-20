# Loom Code

Loom Code is a local-first AI coding agent for VS Code. It pairs a polished
React chat UI with a TypeScript extension host and a fast Go agent backend, so
the model can inspect code, edit files, run commands, ask planning questions,
use MCP tools, and keep long work visible without hiding the machinery.

## Why Loom Code?

Loom is built for developers who want an agent they can actually read, steer,
and trust inside their editor.

- **Fast local agent backend**: the LLM loop, tools, prompt assembly, indexing,
  MCP client, and sub-agent orchestration run in Go.
- **VS Code-native control plane**: the TypeScript host owns editor APIs,
  SecretStorage, approvals, sessions, diagnostics, diff previews, and webview
  state.
- **Readable transcripts**: every tool call renders as one compact card with
  input, output, approval state, and expandable details.
- **Real approval controls**: approve one action, batch approvals, allow a
  category, remember specific rules, or keep everything manual.
- **Provider choice**: use Anthropic, OpenAI, OpenAI-compatible providers such
  as OpenRouter, Groq, Cerebras, Vercel AI Gateway, Azure OpenAI, vLLM, or
  local OpenAI-compatible servers such as Ollama and LM Studio.
- **Repo-native behavior**: Loom loads `.loomrules`, provider-native agent
  instruction files, skills, sub-agent presets, and slash commands so the
  agent follows the conventions your repo already carries.

## Features

**Agent modes**

Switch between Code, Architect, Ask, and Debug modes. Modes define the active
prompt and available tools, and natural-language requests such as "use
architect mode" are detected by shared host/webview code. Custom modes can be
added through `loom.modes`.

**Safe edits and command execution**

Loom can read files (with `offset`/`limit` for narrow slices of large files),
search content with regex, locate files by name glob via `find_files`,
inspect diagnostics, apply diffs, run foreground or background commands,
read process output, and stop processes. Write and execute tools require
approval unless your workspace policy allows them.
Commands use a platform-native shell by default (PowerShell on Windows,
`/bin/bash` or `/bin/sh` on macOS/Linux), and can opt into a specific shell or
workspace-relative working directory when needed.

**Sessions that survive reloads**

Conversation sessions are owned by the VS Code host. Session indexes live in
workspace state, while larger session bodies are stored under the extension
storage directory so long chats stay usable.

**MCP support**

Configure stdio MCP servers through VS Code settings, `.vscode/mcp.json`, or
the user MCP config directory. MCP tools appear beside Loom's built-in tools
and keep their own approval category.

**Workspace awareness**

Loom maintains a workspace symbol index in Go. Tree-sitter extraction is
available in CGO builds, non-CGO builds keep working with empty symbol lists,
and optional embeddings add semantic search through Ollama or Voyage.

**Read-only sub-agents**

The built-in `research` sub-agent preset lets the main agent delegate focused
investigations in parallel. Sub-agents use isolated conversation state and
return structured Answer / Evidence / Unverified summaries. Workspaces can add
custom presets under `.loom/agents/`.

**Per-conversation scratchpad**

Loom exposes a `scratchpad` tool the agent uses as private working memory
between turns — a single markdown buffer persisted at
`<workspace>/.loom/scratchpad/<conversationId>.md`. The agent reads,
writes, appends to, or clears it; the user sees the calls as quiet tool
cards in the transcript. Survives reload, capped at 64 KB.

**Slash commands**

Workspace slash commands live in `.loom/commands/`. Type `/` in the composer to
expand a command into the user message before it is sent to the agent.

**First-run setup**

The first-run panel is global, not per workspace. Pick a provider once, store
API keys in VS Code SecretStorage, tune model settings, and override per
workspace only when needed.

**Doubling Continue**

Long-running tasks stop after 32 model/tool turns by default. The stop card's
Continue button raises the cap each time you press it (32 → 64 → 128 → …), so
you can resume without losing conversation state. Other stop reasons (errors,
cancellations) keep the default cap when resumed.

## Install

Loom Code is currently distributed as per-platform VSIX packages from GitHub
Releases or local builds.

```bash
code --install-extension dist/loom-win32-x64.vsix
```

Choose the package that matches your platform:

- `loom-darwin-arm64.vsix`
- `loom-darwin-x64.vsix`
- `loom-linux-arm64.vsix`
- `loom-linux-x64.vsix`
- `loom-win32-x64.vsix`

See [INSTALL.md](INSTALL.md) for the full install and first-run guide. If macOS
Gatekeeper or Windows SmartScreen blocks an unsigned binary, see
[TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Configuration

Important settings:

- `loom.provider`: `anthropic`, `openai`, `openai-compatible`, or `local`
- `openai-compatible` presets include OpenRouter, Groq, Cerebras, Google AI Studio (Gemini), Vercel AI Gateway, LM Studio, and custom endpoints; setup surfaces include an official console link for key creation
- `loom.mcp.servers`: stdio MCP server configuration
- `loom.embeddings.provider`: `disabled`, `ollama`, or `voyage`
- `loom.telemetry.enabled`: opt-in telemetry, disabled by default
- `loom.ui.accent`, `loom.ui.density`, `loom.ui.themeBias`: webview theme

Telemetry never sends prompts, file contents, workspace paths, API keys, or raw
machine IDs.

## Project Instructions

Loom only reads `.loomrules` for project rules and `.loom/skills/`,
`.loom/agents/`, `.loom/commands/` for skills, sub-agent presets, and slash
commands. Foreign-format files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
`.claude/`, `.codex/`, `.gemini/`, `.cursor/`, `.cursorrules`,
`.github/copilot-instructions.md`, `.github/instructions/`) are not loaded —
this keeps the prompt prefix small and provider-neutral. Workspaces that want
to share content across tools should symlink or generate `.loomrules` from
their other instruction file.

See [docs/loomrules.md](docs/loomrules.md) for size limits and examples.

## Architecture

```text
React webview <-> TypeScript extension host <-> Go agent binary
        postMessage        JSON-RPC 2.0 over LSP framing
```

Wire types live in `src/shared/protocol.ts`. The internal extension-agent RPC
uses LSP `Content-Length` framing; external MCP stdio servers use
newline-delimited JSON-RPC in `agent/internal/mcp/`.

## Development

Requires Node 20+ and Go 1.22+.

```bash
npm run install:all
npm run build
```

This builds the Go agent for the current platform, the React webview, and the
extension bundle. To package release VSIX files for every supported platform:

```bash
npm run package
```

Before release packaging, bump both `package.json` and `package-lock.json` so
the generated VSIX metadata matches the release version.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow and PR
expectations. See [SUBAGENTS.md](SUBAGENTS.md) for the sub-agent contract and
[TROUBLESHOOTING.md](TROUBLESHOOTING.md) for setup, packaging, and runtime
issues.
