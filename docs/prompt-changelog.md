# Prompt Changelog

Reverse-chronological notes for meaningful Loom prompt-layer changes.

## 2026-05-20 - Larger sub-agent research budget and batch-overlap guidance

- Affected files: `agent/internal/loop/preset.go`,
  `agent/internal/prompts/code.md`, `agent/internal/prompts/debug.md`,
  `agent/internal/prompts/ask.md`, `agent/internal/prompts/architect.md`,
  `agent/internal/tools/descriptions/spawn_subagent.md`, `SUBAGENTS.md`.
- Rationale: real multi-file handoffs were hitting the sub-agent budget early
  and parent execution looked blocked when the model spawned a sub-agent as
  the only tool in a turn. The built-in research preset now has a 45-turn /
  100k-input-token budget, and prompts/tool docs explain that sub-agents
  overlap with other tool calls emitted in the same batch while the next parent
  model turn waits for that batch's results.
- Eval impact: prompt snapshots change; loop tests assert the new built-in
  preset budget.

## 2026-05-20 - Proactive sub-agents and seeded implementation todos

- Affected files: `agent/internal/prompts/code.md`,
  `agent/internal/prompts/debug.md`, `agent/internal/prompts/architect.md`,
  `agent/internal/tools/descriptions/update_todos.md`,
  `agent/internal/eval/scenarios.go`.
- Rationale: Code/Debug had drifted from proactive delegation after the
  sub-agent guardrail pass, so multi-file read-only surveys often stayed in
  the parent context. The prompts now strongly prefer focused sub-agents for
  unfamiliar multi-file investigation while keeping the actual per-turn cap
  at 3. Seeded plan handoff todos are also described as authoritative: the
  agent should preserve IDs/text and update statuses only.
- Eval impact: Code/Debug/Architect prompt snapshots and the `update_todos`
  tool description change the stable prefix. Added an eval scenario requiring
  a proactive sub-agent on a multi-file transcript-flow survey.

## 2026-05-20 - apply_diff newText guidance + provider-parity assets

- Affected files: `agent/internal/tools/tools.go`,
  `agent/internal/tools/descriptions/apply_diff.md`, `.loomrules`,
  `.codex/agents/*.md`, `.codex/commands/*.md`, `.gemini/agents/*.md`,
  `.gemini/commands/*.md`, `.github/instructions/loom.instructions.md`.
- Rationale: two recurring failure modes around `apply_diff`. (1) The
  `newText` schema description (`"Replacement text. Required for both
  edit modes."`) was too terse — models passed `null`, arrays of
  lines, or `{text: "..."}` objects and got a generic
  `newText must be a string` error with no recovery hint. The new
  description spells out the JSON-string requirement, the multiline
  `\n` convention, and the empty-string-for-delete convention, and
  the TS validator now reports the actual JS type and a recovery
  suffix on mismatch. (2) `oldText not found` recovery still steers
  to range edits via `search`; the symmetric type-mismatch path now
  follows the same shape so the model sees one consistent recovery
  contract.
- Companion change: cross-provider parity. The repo previously
  shipped `.claude/agents/`, `.claude/commands/`, and Anthropic
  identity prose in `CLAUDE.md` but had no equivalents for the
  openai / codex or gemini families. Added `.loomrules` (universal,
  top-precedence), `.codex/agents/*.md` + `.codex/commands/*.md`,
  `.gemini/agents/*.md` + `.gemini/commands/*.md`, and
  `.github/instructions/loom.instructions.md`. The rules loader and
  sub-agent presets already routed per-family via `familycfg.go` —
  this fills in the asset side so a codex- or gemini-driven session
  on this repo sees its own family's content instead of falling back
  to Claude-targeted prose.
- Eval impact: `apply_diff` description changes are in the stable
  system-prompt prefix (one cache invalidation, then stabilises).
  `.loomrules` and per-family rules/agents land in the volatile
  rules-bundle tail. Run `npm run eval` when provider credentials
  are available.

## 2026-05-20 - Command shell compatibility guidance

- Affected files: `agent/internal/tools/descriptions/run_command.md`,
  `agent/internal/tools/descriptions/run_command_background.md`,
  `agent/internal/prompts/code.md`, `agent/internal/prompts/debug.md`.
- Rationale: command execution is now shell-aware and defaults to a
  platform-native shell. The model needs to know about explicit `shell` and
  `cwd` inputs, and should retry only when output points to a shell mismatch
  rather than blindly rerunning side-effectful commands.
- Eval impact: tool descriptions and Code/Debug prompts change. Run
  `npm run eval` when provider credentials are available.

## 2026-05-20 - Rules envelope: fallback annotation, dedup aliases, Copilot/Cursor scope

- Affected files: `agent/internal/normalize/normalize.go`,
  `agent/internal/rules/rules.go`,
  `agent/internal/normalize/normalize_test.go`,
  `agent/internal/rules/rules_test.go`.
- Rationale: three confusion vectors in the external-context normalization
  pipeline — (1) `applyTo:` (Copilot) and `globs:` (Cursor) frontmatter
  scoping was stripped wholesale, so a TS-only rule landed as a global
  rule; (2) cross-family fallback rules (CLAUDE.md picked up under OpenAI)
  had no signal telling the model to apply substance over identity; (3)
  content-hash dedup silently dropped the second source path so users
  couldn't see why their other file "didn't apply".
- Envelope changes (deliberately byte-changing — `normalize.Version`
  bumped 1 → 2 to invalidate cached prefixes cleanly):
  - Per-rule `<rule>` tag may now carry `loaded-as="fallback"` when the
    rule's origin doesn't match the active family.
  - Per-rule `<rule>` tag may carry `also="alt1,alt2"` listing the paths
    of files whose content deduplicated into this kept block.
  - Top-level `<rules>` envelope gains a one-line "ignore identity
    claims" guidance sentence iff at least one fallback rule is present.
  - Copilot/Cursor frontmatter now contributes a leading
    `> Scope: applies to <glob(s)>` markdown blockquote when `applyTo:`
    or `globs:` is present; the rest of the frontmatter is still stripped.
- Eval impact: one-shot cache miss on first turn after upgrade; bundle
  hash is intentionally different. Native-only workspaces (no fallback,
  no dedup, no scoped frontmatter) see no rendered bytes change beyond
  the Version bump in the hash mix.

## 2026-05-20 - LocalExec tool signature gains context.Context

- Affected files: `agent/internal/tools/tools.go`,
  `agent/internal/tools/search.go`, `agent/internal/tools/find_files.go`,
  `agent/internal/tools/index_tools.go`,
  `agent/internal/tools/embed_tools.go`,
  `agent/internal/mcp/tools.go`, `agent/internal/mcp/manager.go`,
  `agent/internal/loop/loop.go`.
- Rationale: `tools.Tool.LocalExec` previously had signature
  `func(workspaceRoot, input) (string, error)` — no ctx, so search,
  find_files, semantic_search, and MCP tools dropped the task ctx and
  used `context.Background()` internally. User cancels mid-tool didn't
  propagate. Signature is now
  `func(ctx, workspaceRoot, input) (string, error)`; all in-tree tools
  and the MCP adapter were updated; the dead `Driver.ExecTool` method
  (no callers) was removed.
- Eval impact: none on prompt bytes. Improves cancellation latency.

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
