# Contributing

Thanks for your interest in this project. This guide covers the human
contributor flow. For AI agents working on this codebase, see `CLAUDE.md`
and `AGENTS.md`.

## Setup

Requirements:
- Node.js 20+
- Go 1.22+
- VS Code (for testing)

```bash
git clone <repo-url>
cd loom
npm install
(cd webview-ui && npm install)
npm run build
```

## Project structure

See `CLAUDE.md` for the canonical reference. Short version:

```
src/                  TypeScript extension host
webview-ui/           React chat UI
agent/                Go agent binary
scripts/              build + package scripts
.github/              CI, templates, Dependabot
.claude/              Claude Code config (subagents, commands)
.cursor/              Cursor rules
```

## Development workflow

1. Open the repo in VS Code.
2. Press **F5** to launch an Extension Development Host with the extension
   loaded.
3. Run **Loom: Set Anthropic API Key** in the dev host, or export
   `ANTHROPIC_API_KEY` before launching.
4. Open the **My Agent** view in the activity bar.
5. Make changes. Rebuild the affected layer:
   - `npm run build:ts` — extension host
   - `npm run build:webview` — React UI
   - `npm run build:agent` — Go binary (current platform)
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
- CI must pass (build on all three OSes, `go vet` clean)
- Update `CLAUDE.md` if you change architecture, not just implementation

## Releasing

Tag a commit with `v0.X.Y` and push. The release workflow
(`.github/workflows/release.yml`) cross-compiles, packages per-platform
VSIX files, and creates a draft GitHub release. Marketplace publish is
gated behind manual confirmation.

## Reporting bugs

Use `.github/ISSUE_TEMPLATE/bug_report.yml`. Include:
- Extension version
- Platform + VS Code version
- Reproduction steps
- Redacted logs from "Output → My Agent"

## Code of conduct

Be kind. Assume good faith. Disagree on technical points without making it
personal.
