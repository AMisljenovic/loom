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

## Changing prompts

Prompt changes include edits to mode prompts, output conventions, tool
descriptions, built-in skills, sub-agent contracts, or project-rule loading.

- Update `docs/prompt-changelog.md` with what changed and why.
- Run `go -C agent run ./cmd/prompt-snapshot --out ../docs/prompt-snapshots --check`.
- Run `npm run eval` when provider credentials are available.
- Keep tool guidance in `agent/internal/tools/descriptions/*.md`; Go schemas
  remain the validation source.
- Keep shared output style in `agent/internal/prompts/_output_conventions.md`;
  mode prompts should only add mode-specific output guidance.

## Releasing

Versioning and changelog are driven by [Conventional Commits](#commit-style).
`npm run release` scans commits since the last `v*.*.*` tag, decides the bump
level (`feat` → minor, `fix`/`perf`/`refactor` → patch, `!` or
`BREAKING CHANGE:` in the body → major), writes a new `CHANGELOG.md` section,
and bumps `package.json` + `package-lock.json`. Commits typed `chore`,
`docs`, `test`, `ci`, `build`, `style` are skipped and do not bump the
version.

```bash
npm run release --dry-run   # preview the bump and changelog section
npm run release             # apply the file changes (does NOT commit or tag)
```

After running, review the diff, then:

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: release vX.Y.Z"
git tag vX.Y.Z
git push --follow-tags
```

Before tagging, run:

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

`README.md` stays evergreen — do not add per-version "What's New" sections;
the Marketplace and the in-editor extension page render `CHANGELOG.md` as a
separate Changelog tab. The release workflow
(`.github/workflows/release.yml`) packages per-platform VSIX files on tag
push and creates a draft GitHub release whose body is the matching
`## <version>` section of `CHANGELOG.md`. Marketplace publish is gated
behind manual confirmation.

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
