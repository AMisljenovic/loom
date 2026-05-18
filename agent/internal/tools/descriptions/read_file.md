---
name: read_file
category: read
requires_approval: false
---

## Purpose
Read a slice (or all) of a UTF-8 text file relative to the workspace root.

## Search first, read narrowly
This is **not** the right first tool for navigation. Use `search` to locate the
relevant lines, then `read_file` with `offset` and `limit` to inspect just
that region. Use `find_files` when you need to know where a file lives.
Whole-file reads are appropriate only for short files (~200 lines), files you
are about to fully rewrite via `apply_diff`, or when you genuinely need the
entire body.

## When to use
- You have a specific file path and a known line region you need to inspect.
- You are about to call `apply_diff` and need the current file body.

## When NOT to use
- For binary files (images, executables). The result will be unusable.
- To list a directory — use `list_dir`.
- To find files by name pattern — use `find_files`.
- To search across many files — use `search`.

## Input
- `path` (string, required) — workspace-relative path. Absolute paths are
  rejected. Forward slashes work cross-platform.
- `offset` (number, optional) — 1-based starting line. Default 1.
- `limit` (number, optional) — max lines to return. Default unlimited.

## Behavior
- Returns the requested slice with a header line of the form
  `// Lines <start>-<end> of <total> in <path>`. When the slice is truncated
  the header notes how to read more (raise `offset` or pass `limit`).
- Files over ~256 KB are soft-capped to the first 2000 lines when no `limit`
  is supplied. Pass an explicit `offset`/`limit` to walk a large file.
- An error result means the file is missing, a directory, or unreadable.

## Examples

```json
{"path": "src/extension.ts", "offset": 120, "limit": 60}
```

Read 60 lines starting at line 120 — exactly the region `search` pointed at.

```json
{"path": "agent/internal/loop/loop.go"}
```

Whole-file read. Acceptable here because you intend to follow up with
`apply_diff`.
