---
name: find_files
category: read
requires_approval: false
---

## Purpose
List workspace files whose paths match a filename glob.

## When to use
- You need to know where files live (e.g. "all `.tsx` components", "every
  `loop_test.go`").
- You want to scope a follow-up `search` or `read_file` to a known subset.
- You are surveying an unfamiliar area and need a quick map of the files.

## When NOT to use
- For matching file *contents* — use `search`.
- To inspect a single directory you already know — `list_dir` is simpler.
- To inspect the contents of any matching file — pair this with `read_file`
  using `offset`/`limit`.

## Input
- `pattern` (string, required) — filename glob. Supports `*`, `?`, and `**`
  for recursive matching. Always uses forward slashes.
- `path` (string, optional) — workspace-relative root to search under
  (default: workspace root).
- `maxResults` (number, optional) — cap on returned paths. Default 200.

## Behavior
- Returns one workspace-relative path per line, sorted lexically, followed
  by a `(N matches)` footer. When truncated the footer says so.
- Hidden directories (`.git`, `node_modules`, `dist`, `out`) are excluded.
- Uses ripgrep when available; falls back to a pure-Go walker.

## Examples

```json
{"pattern": "webview-ui/src/components/**/*.tsx"}
```

Locate every TSX component file.

```json
{"pattern": "**/loop*.go", "path": "agent"}
```

Find all `loop*.go` files inside the Go agent tree.
