---
name: get_diagnostics
category: read
requires_approval: false
---

## Purpose
Get VS Code diagnostics (compiler/linter errors and warnings) for the whole
workspace or a specific file.

## When to use
- Before debugging a failure, to surface what the language server already knows.
- To confirm that a refactor did not introduce new errors elsewhere.
- After the user reports a build problem and you want hard evidence of it.

## When NOT to use
- Immediately after `apply_diff` on the file you just changed — the host
  already attaches new diagnostics as a `<diagnostics-followup>` user message
  on the next turn.
- To check non-language issues (e.g. lint rules disabled in the LSP).

## Input
- `path` (string, optional) — workspace-relative file path. Omit for
  workspace-wide diagnostics.
- `severity` (string, optional) — one of `"error"`, `"warning"`, `"all"`.
  Defaults to `"all"`.

## Behavior
- Diagnostics come from language servers and may be stale immediately after
  edits. Wait ~750ms after an edit before reading them directly.
- Returns an empty result if no diagnostics match. That is not an error.

## Examples

```json
{}
```

All workspace diagnostics.

```json
{"path": "src/panel/ChatPanel.ts", "severity": "error"}
```

Errors only, for one file.
