---
name: list_dir
category: read
requires_approval: false
---

## Purpose
List entries in a directory relative to the workspace root.

## When to use
- You need to discover what's in a directory before reading a specific file.
- You are exploring an unfamiliar area of the workspace.

## When NOT to use
- For recursive listings — call `list_dir` per level, or use `search` with a
  pattern instead.
- To check whether a single named file exists — just `read_file` it and
  handle the error.

## Input
- `path` (string, required) — workspace-relative directory path. Use `"."`
  for the workspace root.

## Behavior
- Returns entries as `kind<TAB>name` lines, where `kind` is `file` or `dir`.
- Entries are not sorted in a guaranteed order. Sort client-side if needed.
- Hidden files (dot-files) are included.

## Examples

```json
{"path": "."}
```

List the workspace root.

```json
{"path": "src/components"}
```

List a subdirectory.
