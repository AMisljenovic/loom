---
name: find_references
category: read
requires_approval: false
---

## Purpose
Find every occurrence of an identifier across the indexed workspace
(name-based, no semantic scoping).

## First choice for "where is X used"
When the question is "who calls this function" or "where does this
constant get read," use `find_references` before `search`. The index
narrows to identifier tokens, so you don't have to wade through string
literals, comments, or substring collisions.

## When to use
- Mapping call sites of a function or method before changing its
  signature.
- Finding every read of a constant or exported variable.
- Scoping a rename — every reference must be visited.

## When NOT to use
- You want the definition, not the usages — use `find_symbol`.
- The name is partial, regex-shaped, or you need cross-file content
  patterns — use `search`.
- The workspace index isn't ready (the tool returns "no references" or
  "workspace index is not available"). Fall back to `search`.

## Input
- `name` (string, required) — exact identifier. Case-sensitive.
- `path` (string, optional) — workspace-relative path prefix to scope
  results (e.g. `webview-ui/src/components`).

## Behavior
- Output is one line per occurrence: `path:line`.
- Name-based: does **not** distinguish overloaded names in different
  scopes. Two unrelated functions with the same name both match.
  Combine with `path` or follow up with `read_file` to disambiguate.
- Returns "no references" when the index is loaded but the name is
  unused.
- Returns "workspace index is not available" when the indexer hasn't
  finished or isn't running — fall back to `search`.

## Examples

```json
{"name": "wireMessages"}
```

All callers and references to `wireMessages` workspace-wide.

```json
{"name": "BUILTIN_MODES", "path": "src"}
```

Scoped to the TypeScript extension host — skips the Go agent.
