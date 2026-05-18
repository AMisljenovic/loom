---
name: search
category: read
requires_approval: false
---

## Purpose
Search the codebase with a regex query and return `path:line:snippet` matches.

## First tool for most navigation
Reach for `search` before `read_file` when you don't already know exactly
which lines you need. Combine `globs` to scope to a language or directory,
then follow up with a narrow `read_file` slice on the lines that matched.

## When to use
- Locating string literals, symbol names, or patterns across many files.
- Confirming where a function, constant, or import is referenced.
- Quickly checking whether a feature exists before adding it.

## When NOT to use
- To find files by name pattern (no content match) — use `find_files`.
- For semantic "find me code that does X" queries — use `semantic_search`
  if available, or `find_references` when you have a specific symbol.
- For inspecting a single known file — `read_file` is direct and faster.

## Input
- `query` (string, required) — regex pattern. Standard Go regex syntax.
- `path` (string, optional) — workspace-relative path to restrict the search.
  Defaults to the workspace root.
- `globs` (array of strings, optional) — file include patterns
  (e.g. `["*.ts", "*.tsx"]`).
- `maxResults` (number, optional) — cap on returned lines. Use to bound noisy
  queries.

## Behavior
- Returns one match per line as `path:line:snippet`. Snippets are trimmed
  to a reasonable column count.
- Hidden directories (`.git`, `node_modules`) are usually excluded by the
  underlying searcher. Don't assume they are reachable.
- Anchors (`^`, `$`) match per line, not per file.

## Examples

```json
{"query": "buildStableSystem", "path": "agent"}
```

Find the prompt-build function inside the Go agent.

```json
{"query": "TODO|FIXME", "globs": ["*.ts", "*.tsx"], "maxResults": 50}
```

Scoped, capped query — typical first-step navigation before reading.
