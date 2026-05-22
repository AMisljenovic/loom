---
name: git_diff
category: read
requires_approval: false
---

## Purpose
Return the working-tree diff (unstaged by default, or staged) so you can see
exactly what changed before drafting a commit or proposing an edit.

## When to use
- Drafting a commit message — call `git_status` first to see what's there,
  then `git_diff` for each side (staged, then unstaged) you plan to commit.
- Confirming the effect of a recent `apply_diff` or external edit before
  surfacing it to the user.
- Reviewing a patch the user just made by hand.

## When NOT to use
- You need to mutate the index (`git add`, `git commit`, etc.) — use
  `run_command`; this tool is strictly read-only.
- The diff is expected to be huge (generated files, lockfiles). Pass `paths`
  to restrict, or fall back to `run_command` for the full patch.

## Input
- `staged` (boolean, optional) — when true, runs `git diff --cached`. Default
  is false (unstaged changes).
- `paths` (array of strings, optional) — workspace-relative paths to restrict
  the diff to. Useful when `git_status` showed many files but you only need
  one.
- `maxBytes` (number, optional) — cap on returned bytes. Default 65536, hard
  cap 262144. Patches exceeding the cap are truncated with a marker.

## Behavior
- Output begins with `Diff (unstaged)` or `Diff (staged)`, optionally followed
  by the path list, then the raw patch.
- An empty diff returns `(no changes)`.
- Truncation appends a `// Diff truncated at N bytes.` marker. Narrow `paths`
  or raise `maxBytes` to see more.

## Examples

```json
{"staged": true}
```

Full staged diff for the workspace.

```json
{"paths": ["src/foo.ts", "src/bar.ts"], "maxBytes": 32768}
```

Unstaged diff limited to two files and 32 KB of output.
