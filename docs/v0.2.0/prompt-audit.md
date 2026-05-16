# Prompt-layer audit — 2026-05-16

Baseline before any v0.2.0 prompt rewrites. Read against the snapshots in
[docs/prompt-snapshots/](../prompt-snapshots/).

## Snapshot sizes (stable prefix only, empty workspace)

| Mode      | Lines | Includes |
|-----------|-------|----------|
| code      |    84 | full tool registry + skill catalogue + research preset |
| debug     |    77 | full tool registry + skill catalogue + research preset |
| architect |    66 | read-only tools + skill catalogue + research preset |
| ask       |    62 | read-only tools + skill catalogue + research preset |
| research  |    49 | read-only tools + skill catalogue (no sub-agent block) |

Stable prefix is byte-stable across two runs of `go run ./agent/cmd/prompt-snapshot -check`.

## Shared bones (should be DRY across modes)

These appear in multiple mode prompts in near-identical form and are prime
candidates for the shared template (Stage 1.2) or output conventions (Stage 1.3):

1. **"Stream natural-language text directly to the user."** Appears verbatim in
   code, architect, ask, debug. Missing from research.
2. **"When you call a tool, the system displays it — do not narrate the call."**
   Appears in code, architect, debug. Missing from ask, research.
3. **Project rules autoload paragraph.** All four user-facing modes name the
   same file set (`.loomrules`, `CLAUDE.md`/`AGENTS.md`, `.claude/rules/`,
   `.codex/rules/`) with slight phrasing drift. Should be byte-identical.
4. **`spawn_subagent` guidance.** All four user-facing modes describe it as
   "isolated read-only research, pass precise task / enough context / optional
   files." Same shape, different sentences — pull to one source.
5. **"Never write credentials, API keys, or secrets."** Same idea in all four
   modes, three different wordings.
6. **Tool-mention prose.** Each mode invents its own short tool tour (code
   lists everything; debug has a Tools section; architect / ask just gesture
   at "read-only tools"). The tool catalogue below the prompt already lists
   them — the prose is redundant once we land structured tool descriptions
   (Stage 2).
7. **Mode-switch acknowledgement.** Code and ask both have the "extension may
   have already switched" line; architect and debug don't mention it.

## Per-mode flesh (stays specific)

What each mode does that the others should NOT inherit:

- **code**: `<diagnostics-followup>` mechanic (only Code routinely edits, so
  it's the primary place this needs explaining); "codebase summary" closing
  with files changed + commands run + next step. Keep.
- **architect**: explicit no-write constraint list; planning output style
  (numbered steps, trade-offs, open questions); "use `load_skill` *before*
  recommending." Keep.
- **ask**: tool allowlist enumerated inline; "suggest switching to Code mode"
  if user actually wants changes. Keep.
- **debug**: diagnostics-first workflow (`get_diagnostics` / `run_command`
  before reading source); bisection style; quote errors literally; root cause
  before fix; rerun-to-verify. Keep — debug is the only mode whose *process*
  is different from the others.
- **research**: three-section Markdown return contract (Findings / Files /
  Risks); explicit "don't address the end user." Keep — distinct enough that
  it doesn't fit the shared template, but Stage 4 will sharpen the return
  contract.

## Things one mode says the others should adopt

- **`load_skill` before working in a covered area** (architect already says
  this; code and debug should). Move into shared Working Style.
- **Concrete codebase summary at task end** (code/debug; architect/ask should
  use a similar but mode-flavored close — architect ends with the plan, ask
  ends with the answer).

## Things one mode says the others should NOT adopt

- The exhaustive "Tools highlights" block in `code.md` (lines ~5–30 of the
  snapshot) duplicates the catalogue right below. After Stage 2 lands and tool
  descriptions are richer, this whole block should disappear from the mode
  prompt.
- Architect's "load_skill *before* recommending" — phrased that way it implies
  guesswork is the default. Reframe positively in shared template.

## Risks the rewrite should preserve

- **Cache breakpoint stability.** Provider cache hashes the full stable prefix.
  Reordering sections inside `BuildStableSystem` invalidates it everywhere at
  once. If sections move, ship the move in one commit and accept one round of
  cache misses, not many.
- **Tool-registry vs. mode-prompt drift.** Today, mode prompts hard-code tool
  names. After Stage 2 (tool descriptions as data), the mode prompts should
  stop listing tools entirely — the catalogue is the source of truth.

## Snapshot regeneration

```
go run ./agent/cmd/prompt-snapshot -out docs/prompt-snapshots
go run ./agent/cmd/prompt-snapshot -out docs/prompt-snapshots -check  # CI-style
```
