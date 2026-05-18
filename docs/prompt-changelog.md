# Prompt Changelog

Reverse-chronological notes for meaningful Loom prompt-layer changes.

## 2026-05-18 - Scratchpad tool for cross-turn working memory

- Affected files: `agent/internal/tools/tools.go`,
  `agent/internal/tools/descriptions/scratchpad.md` (new),
  `agent/internal/scratchpad/scratchpad.go` (new),
  `agent/internal/conversation/store.go`,
  `agent/internal/loop/loop.go`,
  `agent/internal/loop/scratchpad_exec.go` (new),
  `agent/internal/prompts/code.md`, `architect.md`, `debug.md`.
- Rationale: the loop has no agent-private working memory between turns.
  `update_todos` is user-visible and skills are static; long multi-step
  tasks lost intermediate plans and findings to summarization. The new
  `scratchpad` tool stores a per-conversation markdown buffer at
  `<workspace>/.loom/scratchpad/<conversationId>.md`, supports
  `read`/`write`/`append`/`clear`, persists across reloads, and is
  capped at 64 KB. State mutation follows the `load_skill` pattern
  (LocalExec nil, loop dispatches a helper that takes the Entry).
- Eval impact: tool catalogue grows by one entry between `update_todos`
  and `spawn_subagent`. Stable system prefix cache misses once when the
  new tool is first advertised, then re-stabilizes. Mode prompts (Code,
  Architect, Debug) each gain a single bullet pointing at `scratchpad`.
  Run `npm run eval` when provider credentials are available.

## 2026-05-18 - Sub-agent storm guardrails and external catalogues

- Affected files: `agent/internal/prompts/architect.md`,
  `agent/internal/prompts/ask.md`,
  `agent/internal/tools/descriptions/spawn_subagent.md`,
  `agent/internal/loop/loop.go`, `agent/internal/loop/preset.go`,
  `agent/internal/skills/skills.go`, and the TS command import path.
- Rationale: Architect/Ask guidance was over-delegating broad surveys, causing
  repeated sub-agent truncations. Prompts and tool descriptions now make
  sub-agent use cost-aware and narrowly scoped, the per-turn cap is 3, and
  truncation summaries include recovery guidance. Skills and sub-agent
  catalogues can now include provider-family external entries with explicit
  precedence envelopes when external entries are present.
- Eval impact: prompt snapshots change for modes that expose
  `spawn_subagent`. Stable-prefix output remains byte-identical for the new
  external catalogue envelopes when no external skills or presets exist.

## 2026-05-18 - Range edits and no-whole-file fallback for apply_diff

- Affected files: `src/tools/index.ts`, `src/tools/applyDiffEdits.ts` (new
  pure-logic module), `src/tools/applyDiffRecovery.ts`,
  `agent/internal/tools/tools.go` (apply_diff schema),
  `agent/internal/tools/descriptions/apply_diff.md`,
  `agent/internal/prompts/code.md`, `agent/internal/prompts/debug.md`.
- Rationale: on 1000+ line files the old recovery contract ("re-emit the
  whole file as oldText/newText") forced the model to stream tens of
  thousands of output tokens, taking 2-5 minutes per edit and frequently
  failing again. `apply_diff` now accepts a second edit shape —
  `{startLine, endLine, newText}` — and the failure message + Code/Debug
  prompts steer the model to use a tight range edit instead of a whole-file
  rewrite. Multi-match errors enumerate every matched line so the model can
  pivot in one turn. Edits within a single call sort range-first
  descending, anchor-after, so line numbers stay valid.
- Eval impact: tool catalogue order is unchanged; only the apply_diff
  schema grows. Stable system prefix cache misses once, then re-stabilizes.
  Run `npm run eval` with provider credentials.

## 2026-05-18 - Search-first discipline and delegate-by-default

- Affected files: `agent/internal/tools/tools.go`,
  `agent/internal/tools/find_files.go` (new),
  `agent/internal/tools/descriptions/read_file.md`,
  `agent/internal/tools/descriptions/search.md`,
  `agent/internal/tools/descriptions/list_dir.md`,
  `agent/internal/tools/descriptions/spawn_subagent.md`,
  `agent/internal/tools/descriptions/find_files.md` (new),
  `agent/internal/prompts/code.md`,
  `agent/internal/prompts/architect.md`,
  `agent/internal/prompts/ask.md`.
- Rationale: the model was reading whole files where targeted `search` plus
  a narrow read would do, and rarely spawning sub-agents because the
  guidance gated delegation on "non-trivial" multi-file work. `read_file`
  now accepts `offset`/`limit` and soft-caps very large files; a new
  `find_files` tool fills the filename-pattern (glob) gap. Mode prompts and
  the `spawn_subagent` description now lead with "search first, read
  narrowly" and "delegate by default for multi-file surveys, run sub-agents
  in parallel."
- Eval impact: tool catalogue gains `find_files`; `read_file` schema gains
  optional `offset`/`limit`. The stable system prefix changes once (cache
  miss expected) and then stabilizes — tool order is unchanged, only the
  read_file schema and the description bodies grow. Run `npm run eval` with
  provider credentials.

## 2026-05-18 - Diff recovery and live todos

- Affected files: `agent/internal/prompts/code.md`,
  `agent/internal/prompts/debug.md`,
  `agent/internal/tools/descriptions/apply_diff.md`,
  `agent/internal/tools/descriptions/update_todos.md`.
- Rationale: failed exact-match edits should recover by reading the current
  file and replacing the full contents once, rather than repeatedly guessing
  partial `oldText` snippets. Code and Debug can also maintain a visible
  task checklist through `update_todos`.
- Eval impact: tool catalogue gains `update_todos`; Code/Debug prompt
  snapshots change. Run `npm run eval` with provider credentials.

## 2026-05-17 - Universal convention-file fallback in rules bundle

- Affected files: `agent/internal/rules/rules.go`,
  `agent/internal/rules/rules_test.go`, `docs/loomrules.md`.
- Rationale: Loom is provider-agnostic, but the rules loader previously only
  recognised `CLAUDE.md`/`.claude/rules/` for Anthropic and
  `AGENTS.md`/`.codex/rules/` for OpenAI. Workspaces set up for Copilot,
  Gemini, or Cursor were silently ignored. The loader now falls back to the
  opposite provider's files, `.github/copilot-instructions.md`,
  `.github/instructions/*.md`, `GEMINI.md`, `.gemini/rules/*.md`,
  `.cursor/rules/*.md`, and `.cursorrules` when the provider's native files
  are absent. `.loomrules` is always loaded first and the envelope now
  carries a `precedence=".loomrules"` attribute plus a one-line conflict
  note.
- Eval impact: prompt envelope gains a precedence attribute and conflict
  note (byte-stable across turns). The `<rules>` body is unchanged when a
  workspace's provider-native files are present, so the bundle hash for
  existing workspaces is unchanged.

## 2026-05-16 - User-selected references in prompts

- Affected files: `agent/internal/prompts/_output_conventions.md`,
  `agent/internal/loop/references.go`.
- Rationale: make file/folder references attached in the composer explicit
  starting context while preserving tool-based verification for deeper reads.
- Eval impact: prompt snapshots change; existing evals should continue to
  pass because references are only added when supplied by the UI.

## 2026-05-16 - Structured planning questions and proposed plans

- Affected files: `agent/internal/prompts/architect.md`,
  `agent/internal/tools/descriptions/ask_questions.md`,
  `agent/internal/eval/scenarios.go`.
- Rationale: replace plain-text open questions with a structured UI question
  flow, then make final Architect plans detectable as Markdown documents.
- Eval impact: adds an Architect scenario that must call `ask_questions` and
  finish with a `<proposed_plan>` block.

## 2026-05-16 - Enforce iteration summaries after tool work

- Affected files: `agent/internal/prompts/code.md`,
  `agent/internal/prompts/debug.md`,
  `agent/internal/prompts/_output_conventions.md`,
  `agent/internal/eval/scenarios.go`.
- Rationale: keep the final response from dropping what changed, what was
  verified, and what remains after multi-step tool iterations.
- Eval impact: Code and Debug scenarios now assert the final answer contains
  `Iteration summary`.

## 2026-05-16 - v0.2.0 prompt version, eval harness, and rules docs

- Affected files: `agent/internal/eval/`, `agent/cmd/eval/`,
  `agent/internal/prompts/version.go`, `docs/loomrules.md`,
  `docs/prompt-changelog.md`.
- Rationale: make prompt changes measurable and traceable across usage events.
- Eval impact: adds `npm run eval`; full provider-backed run requires API
  credentials.

## 2026-05-16 - Skills library expansion

- Affected files: `agent/internal/skills/builtin/*.md`,
  `agent/internal/skills/skills.go`.
- Rationale: make skill loading useful for Go, testing, VS Code, React,
  TypeScript, error handling, Git workflow, and performance investigation.
- Eval impact: adds a scenario expecting Go and error-handling skills before
  code changes.

## 2026-05-16 - Sub-agent briefing contract

- Affected files: `agent/internal/prompts/code.md`,
  `agent/internal/prompts/architect.md`, `agent/internal/prompts/research.md`,
  `SUBAGENTS.md`.
- Rationale: make parent prompts brief research sub-agents with enough context
  and make sub-agent summaries useful to the parent.
- Eval impact: adds a scenario that checks multiple non-trivial sub-agent
  contexts.

## 2026-05-16 - Tool descriptions moved to Markdown

- Affected files: `agent/internal/tools/descriptions/*.md`,
  `agent/internal/tools/descriptions.go`, `agent/internal/tools/tools.go`.
- Rationale: keep rich model-facing tool guidance versioned beside the tools
  without burying prose in Go literals.
- Eval impact: existing tool-description tests validate files and registry
  coverage.

## 2026-05-16 - Shared output conventions

- Affected files: `agent/internal/prompts/_output_conventions.md`,
  `agent/internal/prompts/prompts.go`, `agent/internal/loop/loop.go`.
- Rationale: give every mode the same citation, code block, brevity, and
  uncertainty rules.
- Eval impact: prompt snapshots capture the stable prefix with the shared
  conventions included.

## 2026-05-16 - Mode prompt template and rewrites

- Affected files: `agent/internal/prompts/_template.md`,
  `agent/internal/prompts/code.md`, `architect.md`, `ask.md`, `debug.md`,
  `research.md`.
- Rationale: make mode differences intentional while retaining one house style.
- Eval impact: prompt snapshots updated for all built-in modes and research.

## 2026-05-16 - Prompt snapshot baseline

- Affected files: `agent/cmd/prompt-snapshot/`,
  `docs/prompt-snapshots/*.txt`, `docs/v0.2.0/prompt-audit.md`.
- Rationale: preserve stable-prefix baselines before further prompt changes.
- Eval impact: `go -C agent run ./cmd/prompt-snapshot --out ../docs/prompt-snapshots --check`
  verifies snapshot drift.
