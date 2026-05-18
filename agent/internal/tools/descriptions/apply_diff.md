---
name: apply_diff
category: write
requires_approval: true
---

## Purpose
Modify or create a file using one or more edits — anchor-matched
(`oldText`/`newText`) or line-range (`startLine`/`endLine`/`newText`).

## When to use
- Change a file's contents. Use **anchor edits** for small unique regions.
  Use **range edits** when the region is large or already known by line
  number (e.g. after a `search` hit), or when anchor matching has failed.
- Create a new file: one anchor edit with empty `oldText` and the body as
  `newText`.

## When NOT to use
- For renames or deletes — ask the user.
- To stage a change for review. `apply_diff` writes immediately (subject
  to approval).

## Input
- `path` (string, required) — workspace-relative path.
- `edits` (array, required) — one or more edit objects. Each is either:
  - Anchor: `{ "oldText": "...", "newText": "..." }`
  - Range: `{ "startLine": N, "endLine": M, "newText": "..." }`
    (1-based, inclusive). For pure insert, set `endLine = startLine - 1`.

## Behavior
- Anchor `oldText` must match exactly and uniquely. Multi-match errors
  list every matched line number — pick one and re-issue as a range edit,
  or tighten `oldText`.
- Range edits replace lines N..M. Line endings (`\r\n` or `\n`) are
  preserved.
- In one call: range edits apply first in descending `startLine` order so
  earlier line numbers stay valid; anchor edits apply to the resulting
  buffer.
- On any failure, **do not re-emit the whole file**. Use `search` to find
  the exact lines, then issue a tight range edit for the changed slice.
- After a successful apply, the host re-fetches diagnostics (~750ms
  settle) and replays new errors as a `<diagnostics-followup>` user
  message. Do not pre-emptively call `get_diagnostics` on a just-edited
  file.
- Requires user approval unless the `write` category is auto-approved.

## Examples

```json
{"path": "src/foo.ts", "edits": [{"oldText": "const x = 1;", "newText": "const x = 2;"}]}
```

Anchor edit — small, unique region.

```json
{"path": "agent/internal/loop/loop.go", "edits": [{"startLine": 412, "endLine": 418, "newText": "if err := registry.Validate(); err != nil {\n    return err\n}\n"}]}
```

Range edit — replace seven lines in a large file after locating them with
`search`. No full-file rewrite needed.

```json
{"path": "src/new.ts", "edits": [{"oldText": "", "newText": "export const greet = () => 'hi';\n"}]}
```

Create a new file.
