---
name: list_dir
category: read
requires_approval: false
---

## Purpose
List entries in a directory relative to the workspace root.

## When to use
- You need to discover what's in a single directory before reading a file.
- You are exploring an unfamiliar area of the workspace one level at a time.

## When NOT to use
- To find files by name pattern across the tree — use `find_files`.
- For content search — use `search`.
- For recursive listings — `find_files` with a `**` glob is the right tool.
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
