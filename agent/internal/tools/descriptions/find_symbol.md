---
name: find_symbol
category: read
requires_approval: false
---

## Purpose
Find a symbol definition (function, method, type, class, variable, constant)
across the indexed workspace by exact name.

## First choice for identifier hunts
When you have a real identifier — a function name, type name, method —
prefer `find_symbol` over `search`. The index gives you the canonical
definition site directly with line ranges; `search` returns every textual
mention including comments, strings, and unrelated identifiers that
happen to share a prefix.

## When to use
- You know the exact name (`buildStableSystem`, `Driver`, `MAX_TURNS`).
- You want the definition, not all the places that call it — use
  `find_references` for call sites.
- You're scoping a rename or refactor and need every authoritative
  declaration before reading.

## When NOT to use
- The name is partial or fuzzy — use `search` with a regex.
- You want call sites or references, not definitions — use
  `find_references`.
- The workspace index is disabled or empty (the tool returns
  "no matches" or "workspace index is not available"). Fall back to
  `search`.

## Input
- `name` (string, required) — exact symbol name. Case-sensitive.
- `kind` (string, optional) — `function | method | type | interface |
  class | variable | constant`. Narrows results when the same name is
  reused across kinds (common for type + constructor pairs).
- `path` (string, optional) — workspace-relative path prefix to scope the
  search (e.g. `agent/internal/loop`).

## Behavior
- Output is one line per match: `kind<TAB>name<TAB>path:startLine-endLine`.
- Returns "no matches" when the indexer is up but doesn't know the name.
- Returns "workspace index is not available" when the indexer hasn't
  finished or isn't running — fall back to `search`.

## Examples

```json
{"name": "BuildStableSystem"}
```

Find every definition of `BuildStableSystem` across the workspace.

```json
{"name": "Driver", "kind": "type", "path": "agent/internal/loop"}
```

Scoped lookup — type named Driver inside one package.
