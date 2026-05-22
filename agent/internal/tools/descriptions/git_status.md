---
name: git_status
category: read
requires_approval: false
---

## Purpose
Report the git working-tree state: branch, ahead/behind, staged, unstaged, and
untracked files.

## When to use
- You are about to draft a commit message and need to know what changed.
- You want to confirm the working tree is clean before suggesting an edit.
- A user asks "what changed" or "what's modified" in the repo.

## When NOT to use
- You need the actual patch text — call `git_diff` instead.
- You need to mutate the index or working tree — use `run_command` for that
  (it requires approval; this tool is read-only).
- The workspace is not a git repository. The tool will return an error;
  surface it rather than retrying.

## Input
- `path` (string, optional) — workspace-relative subdirectory. Defaults to the
  workspace root. Useful for monorepos when you only care about one submodule.

## Behavior
- Runs `git status --porcelain=v1 -b --untracked-files=normal` and parses the
  output into a structured summary.
- Returns plain text: `Branch:`, optional `Sync: ahead N, behind M`, and per-
  group counts followed by indented file lists.
- A clean working tree returns `Working tree clean.`
- Never modifies refs or the index; safe to call without approval.

## Examples

```json
{}
```

Status for the workspace root.

```json
{"path": "packages/extension"}
```

Status restricted to a monorepo subtree.
