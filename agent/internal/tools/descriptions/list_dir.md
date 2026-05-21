---
name: list_dir
category: read
requires_approval: false
---

## Purpose
List entries in a directory relative to the workspace root.

## Don't browse with this tool
`list_dir` is for inspecting one specific directory you already have in
mind — not for exploring the codebase. Reach for `search` (content),
`find_files` (filename glob), `find_symbol` / `find_references` (symbol
index), or `semantic_search` (intent) before falling back to `list_dir`.
Recursive `list_dir` calls one level at a time waste turns; `find_files`
with `**/*` covers the same ground in one call.

## When to use
- You have a known directory path and want to see what's in it.
- You're confirming the existence of a child folder a tool reported.

## When NOT to use
- To find files by name pattern across the tree — use `find_files` with
  a glob.
- For content search — use `search`.
- For recursive listings — `find_files` with `**` is the right tool.
- To check whether a single named file exists — just `read_file` it and
  handle the error.
- For codebase exploration when you don't yet know which directory
  matters — start with `search`, `find_symbol`, or `semantic_search`.

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
