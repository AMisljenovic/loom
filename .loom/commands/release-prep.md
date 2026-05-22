---
name: release-prep
description: Read-only pre-release checklist for cutting a new Loom version. Verifies build, packaging, and changelog state.
argument-hint: target version, e.g. 0.6.3
---
Pre-release verification for version: $ARGUMENTS

Read-only investigation only. Do NOT run `git tag`, `npm publish`, `vsce publish`, or any state-mutating action. Stop at "ready to release" or "needs work" and let the user drive the actual release.

Checklist:
1. **Version bump status.** `read_file` `package.json`. Compare `version` field against the argument. If they differ, flag that the bump is missing.
2. **Cross-compile health.** `run_command` → `npm run build:agent:all`. This produces per-platform Go binaries. Report any platform that fails. Use `run_command_background` if it will exceed 120 s.
3. **VSIX packaging.** `run_command` → `npm run package`. Confirms per-platform VSIX files build. Report each output path.
4. **Prompt changelog.** `read_file` `docs/prompt-changelog.md`. If any of these areas changed since the previous tag — `agent/internal/prompts/`, `agent/internal/tools/descriptions/`, `agent/internal/skills/builtin/`, `agent/internal/loop/preset.go`, mode definitions in `src/modes.ts` — there must be an entry for the new version.
5. **CLAUDE.md / AGENTS.md / README.md sync.** Run `/docs-sync` semantics: ensure architecture-affecting changes have at least one doc file updated.
6. **Husky hook check.** `read_file` `.husky/pre-commit`. Confirm it still calls `scripts/check-docs-sync.mjs`.

Output:
- One pass/fail line per step.
- If all pass: "Ready to release X.Y.Z" and the suggested commit message style based on recent `git log --oneline -n 5`.
- If any fail: list the failures and the smallest next action the user should take.

Rules:
- Never edit `package.json` or `CHANGELOG.md` directly — surface the gap.
- Never run git tag / push / publish — those are explicit user actions.
