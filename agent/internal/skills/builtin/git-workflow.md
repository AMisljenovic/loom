---
id: git-workflow
synopsis: commit, branch, and PR conventions used in this repo
triggers: [git, commit, branch, pr, pull request, rebase, merge]
---

Conventions that keep history readable and PRs reviewable:

- **One concern per commit.** A commit either adds a feature, fixes a bug,
  refactors, or updates docs — not several at once. "And also" in a commit
  message is a smell.
- **Conventional-commit style.** Prefix the subject line with a type:
  `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`. Scope is
  optional: `feat(loop): ...`. Keep the subject under ~72 characters.
- **Subject answers "what changed."** Body answers "why" — the constraint,
  bug, or design decision behind the change. Skip the body for trivial
  diffs.
- **One concern per PR.** Multiple unrelated commits in a PR force
  reviewers to context-switch. Split.
- **Rebase before review for tidy history; merge after review.** When
  iterating on local commits, `git rebase -i` to fold WIP fixups. Once a
  PR is approved, prefer merge (or rebase-merge) so the review history
  survives in the commit graph if your workflow keeps it.
- **Never rewrite shared history.** Force-pushes are fine on personal
  branches before review; not after. Never to `main`.
- **Pre-commit hook is the line of defence.** This repo's hook
  (`.husky/pre-commit`) blocks commits that touch source without doc
  updates. Update the doc rather than bypassing with `--no-verify`.
- **Don't commit secrets.** API keys, tokens, `.env` files — never. If you
  do by mistake, rotate the secret immediately; rewriting history alone is
  not enough.
- **Pull-request descriptions.** Summary up top, then a short test plan
  (what you ran, what to test). Link the issue if one exists.

When in doubt about whether to split a PR: if its description needs
"and" or bullet points to describe what it does, split it.
