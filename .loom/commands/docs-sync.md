---
name: docs-sync
description: For the current diff, report which of README / CLAUDE / AGENTS / copilot-instructions still need to be updated so the Husky pre-commit hook passes.
---
Check the doc-sync requirement for the current working tree.

Background:
- `scripts/check-docs-sync.mjs` runs in `.husky/pre-commit`.
- It blocks a commit when staged changes touch any of `src/`, `agent/`, `webview-ui/src/`, `package.json`, `scripts/`, `.github/workflows/` AND none of `README.md`, `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md` are also staged.

Workflow:
1. `run_command` → `git status --porcelain` to see staged + unstaged changes.
2. `run_command` → `git diff --cached --name-only` for staged paths only.
3. Classify changed files:
   - **Trigger paths**: under any of the source areas listed above.
   - **Doc paths**: any of the 4 doc files.
4. If trigger paths exist and no doc path is staged, report:
   - Which trigger files were touched.
   - Which of the 4 doc files most likely need an update (suggest based on what the source change is about — e.g. an `agent/internal/loop/` change usually wants `CLAUDE.md` / `AGENTS.md`; a webview change usually wants `README.md` for user-visible behavior).
   - The bypass options (`SKIP_DOCS_CHECK=1` env or `--no-verify`) for genuinely doc-free changes, but make clear those are escape hatches not defaults.
5. If a trigger path has been staged with a doc path, just report "doc-sync ok" with the matched pair.

Rules:
- Read-only. Do not stage, commit, or edit docs without explicit user direction.
- Do not assume which doc file needs the update — present a recommendation, let the user decide.
