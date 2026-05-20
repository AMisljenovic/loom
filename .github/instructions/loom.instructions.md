---
applyTo: "**"
description: Loom-specific editing discipline picked up by Copilot and any tool that respects .github/instructions/.
---

# Loom editing discipline

Project rules that apply to any file in this repository. The full
architecture lives in `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`; this
file captures the editing-tool conventions most likely to bite during
day-to-day work.

## Where the code lives

- `src/` — TypeScript extension host (VS Code API surface)
- `webview-ui/` — React webview, Vite build, talks to the host only
  through `postMessage`
- `agent/` — Go agent binary, JSON-RPC over stdio with LSP framing

Wire types in `src/shared/protocol.ts`. Any change to a message type
must land on both sides in the same change.

## `apply_diff` — never re-emit the whole file

Two edit shapes:

- Anchor: `{ "oldText": "...", "newText": "..." }` — `oldText` must
  match exactly and uniquely.
- Range: `{ "startLine": N, "endLine": M, "newText": "..." }` —
  1-based, inclusive. For pure insert set `endLine = startLine - 1`.

`newText` is **always a JSON string**. For multiline content use
literal `\n` between lines (e.g. `"line1\nline2"`). To delete pass
`""`. Never pass `null`, an array, or an object.

On `oldText not found`, **do not retry with the whole file**. Use
`search` to locate the slice, then re-issue a range edit covering
just the changed lines.

## Search-first, read narrowly

`search` for content, `find_files` for filename globs, `list_dir` for
single-directory inspection. `read_file` accepts `offset`/`limit` (1-
based line window) and soft-caps very large files. Read slices, not
whole files.

## Tool conventions

- Writes and shell commands require approval. Reads do not.
- `run_command` is one-shot (≤120 s). Use the background trio
  (`run_command_background` / `read_process_output` / `kill_process`)
  for long work.
- Parallel tool calls are the default — the loop dispatches them
  concurrently.

## Prompt-cache invariant

The system prompt has a stable prefix (mode + tools + skills
catalogue) and a volatile tail (workspace path + loaded skills +
rules bundle). Tool list order is deterministic. Putting per-turn
data in the prefix breaks Anthropic and OpenAI prompt caching.

## Build & test

- `npm install` (installs Husky pre-commit hook).
- `npm run build` — TS + webview + Go agent.
- `npm run test:ts` — vitest.
- `go test ./...` / `go vet ./...` from `agent/`.

Pre-commit hook: touching `src/`, `agent/`, `webview-ui/src/`,
`package.json`, `scripts/`, or `.github/workflows/` requires at least
one of `README.md`, `CLAUDE.md`, `AGENTS.md`,
`.github/copilot-instructions.md` to also be staged. Use
`SKIP_DOCS_CHECK=1` only when the change genuinely needs no doc
update.

## Style

- TS: strict mode; `unknown` + narrowing over `any`; `node:` prefix on
  built-ins; `await` over `.then()`; named exports.
- Go: `gofmt` + `go vet` clean; wrap errors with
  `fmt.Errorf("context: %w", err)`; channels over shared state.
- React: function components only; `useState`/`useReducer`; VS Code
  CSS variables for theming.
