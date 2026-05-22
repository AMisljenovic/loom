---
name: commit
description: Inspect changed files and draft a conventional commit (and run it on approval).
argument-hint: optional intent/scope hint, e.g. "fix the foo bug"
---
Draft and create a commit for the current working-tree changes.

Optional user intent: $ARGUMENTS

Workflow:
1. Call `git_status` first. If the working tree is clean, stop and tell the
   user there is nothing to commit. Do not invent changes.
2. If `git_status` reports staged files, call `git_diff` with `{"staged": true}`
   to inspect what is about to be committed. If only unstaged changes exist,
   call `git_diff` with `{}` and surface the file list so the user knows
   nothing is staged yet.
3. Read each diff hunk carefully — group related changes, ignore mechanical
   noise (formatting, generated files), and decide the right conventional-
   commit `type(scope): subject`:
   - `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `build`,
     `ci`, `style`.
   - Subject in imperative mood, ≤72 chars, no trailing period.
   - Add a short body (wrapped at ~72 cols) only when the *why* is non-
     obvious from the diff. Skip the body for trivial changes.
   - End with the trailer `Co-Authored-By: Loom
     <274610884+loom-code-ai@users.noreply.github.com>` per the project's
     git-commits rule.
4. Show the user the proposed message before running anything. If nothing is
   staged, propose `git add -A` (or a narrower set) via `run_command` —
   approval will be requested; that's intentional so the user confirms
   scope.
5. Run `git commit -m "<subject>" -m "<body>"` (or a heredoc when the body
   is multi-line) via `run_command`. Approval will be requested.
6. After the commit succeeds, run `git log -1 --oneline` via `run_command` so
   the user can see the new SHA + subject.

Rules:
- Never use `git commit --amend`, `--no-verify`, or `--no-gpg-sign` unless the
  user explicitly asks for them.
- Never `git push` from this command. Pushing is an explicit user action.
- If `git_diff` is truncated, narrow with `paths` rather than guessing — never
  fabricate a description for changes you have not read.
- Treat any provided $ARGUMENTS as a hint about the subject line or scope,
  not as a free pass to skip steps 1–3.
