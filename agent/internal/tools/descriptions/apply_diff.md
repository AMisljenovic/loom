---
name: apply_diff
category: write
requires_approval: true
---

## Purpose
Modify or create a file relative to the workspace root using one or more edits.

## When to use
- You need to change a file's contents. Pass unique `oldText` / `newText`
  pairs that match the file exactly.
- You need to create a new file. Pass a single edit with empty `oldText` and
  the full file body as `newText`.

## When NOT to use
- For renames or deletes — there is no tool for those; ask the user.
- To stage a change for review. `apply_diff` writes immediately (subject to
  approval).

## Input
- `path` (string, required) — workspace-relative path. Absolute paths are
  rejected.
- `edits` (array, required) — one or more `{oldText, newText}` objects.

## Behavior
- Each edit's `oldText` must match the file's current contents exactly,
  including whitespace and indentation. Match is literal, not regex.
- If `oldText` matches multiple places, the call fails — provide more
  surrounding context to make it unique.
- After a successful apply, the host re-fetches diagnostics for the affected
  files (~750ms settle) and replays new errors as a `<diagnostics-followup>`
  user message on the next turn. Do not pre-emptively call `get_diagnostics`
  on a file you just edited.
- Requires user approval unless the `write` category is auto-approved.

## Examples

```json
{"path": "src/foo.ts", "edits": [{"oldText": "const x = 1;", "newText": "const x = 2;"}]}
```

Single-line change.

```json
{"path": "src/new.ts", "edits": [{"oldText": "", "newText": "export const greet = () => 'hi';\n"}]}
```

Create a new file.
