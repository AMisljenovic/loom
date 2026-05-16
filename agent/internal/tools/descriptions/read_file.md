---
name: read_file
category: read
requires_approval: false
---

## Purpose
Read a UTF-8 text file relative to the workspace root.

## When to use
- You need to inspect a specific file's contents before reasoning about it.
- You have a file path from a previous tool result and need its body.

## When NOT to use
- For binary files (images, executables). The result will be unusable.
- To list a directory — use `list_dir`.
- To search across many files — use `search`.

## Input
- `path` (string, required) — workspace-relative path. Absolute paths are
  rejected. Forward slashes work cross-platform.

## Behavior
- Returns the full file body as a string. There is no offset/limit; if the
  file is large, the entire content lands in your context window.
- An error result means the file is missing or unreadable. Do not assume the
  file exists after an error.

## Examples

```json
{"path": "src/extension.ts"}
```

Read the extension entry point.

```json
{"path": "agent/internal/loop/loop.go"}
```

Read the Go agent loop.
