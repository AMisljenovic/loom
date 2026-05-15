# Contributing

Thanks for your interest in Loom. This guide covers the human contributor
flow. For AI agents working on this codebase, see `CLAUDE.md` and `AGENTS.md`.

## Setup

Requirements:

- Node.js 20+
- Go 1.22+
- VS Code for testing

```bash
git clone <repo-url>
cd loom
npm install
(cd webview-ui && npm install)
npm run build
```

## Project structure

See `CLAUDE.md` for the canonical reference. Short version:

```text
src/                  TypeScript extension host
webview-ui/           React chat UI
agent/                Go agent binary
scripts/              build and package scripts
.github/              CI, templates, Dependabot
.claude/              Claude Code config
.cursor/              Cursor rules
assets/               Marketplace and extension icons
media/                Marketplace demo media
```

## Development workflow

1. Open the repo in VS Code.
2. Press **F5** to launch an Extension Development Host.
3. Open the **Loom** view in the activity bar.
4. Complete the first-run setup panel, run **Loom: Set Anthropic API Key**, or
   choose the local provider.
5. Rebuild the affected layer:
   - `npm run build:ts` - extension host
   - `npm run build:webview` - React UI
   - `npm run build:agent` - Go binary for the current platform
6. Reload the Extension Development Host (`Cmd/Ctrl+R`) to pick up changes.

## Commit style

Conventional commits:

- `feat: add search tool`
- `fix: handle empty workspace in agent client`
- `chore: bump anthropic-sdk-go to v0.3.0`
- `docs: clarify RPC framing in CLAUDE.md`
- `refactor: extract llm client interface`

Keep commits focused. One concern per commit, one concern per PR.

## Pull requests

- Fill out the PR template (`.github/pull_request_template.md`)
- Wire-protocol changes must update both TypeScript and Go in the same PR
- CI must pass
- Update `CLAUDE.md`, `AGENTS.md`, and `.github/copilot-instructions.md` when
  architecture changes
- Run the relevant build or test commands locally and list them in the PR

## Releasing

Before tagging:

```bash
npm run build
npm run test:ts
(cd agent && go test ./...)
npm run package
```

Verify `dist/` contains exactly one VSIX for each supported target:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`
- `win32-x64`

Tag a commit with `v0.X.Y` and push. The release workflow
(`.github/workflows/release.yml`) runs the Node packaging path and creates a
draft GitHub release. Marketplace publish is gated behind manual confirmation.

The v1.0 VSIX files are unsigned. Keep the macOS Gatekeeper and Windows
SmartScreen workaround notes in `TROUBLESHOOTING.md` accurate until signing is
implemented.

Marketplace assets live in `assets/` and `media/`. Source exports can be
discarded after the needed files have been copied into those folders.

## Reporting bugs

Use `.github/ISSUE_TEMPLATE/bug_report.yml`. Include:

- Extension version
- Platform and VS Code version
- Reproduction steps
- Redacted logs from "Output -> Loom" or the Extension Host log

Do not include prompts, file contents, API keys, or unredacted workspace paths
in bug reports. Opt-in telemetry follows the same rule.

## Code of conduct

Be kind. Assume good faith. Disagree on technical points without making it
personal.
