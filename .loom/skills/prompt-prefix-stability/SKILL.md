---
id: prompt-prefix-stability
synopsis: keep the cached system-prompt prefix byte-stable when touching the loop or prompts
triggers: [BuildStableSystem, BuildVolatileSystem, cache_control, prompt cache, prefix, system prompt, anthropic, openai cache]
---

Both Anthropic and OpenAI prompt caching key on the **prefix** of the
request being byte-identical to a recent prior call. Loom's loop deliberately
splits the system prompt into a **stable prefix** (cached) and a **volatile
tail** (after the cache breakpoint). Breaking byte-stability silently
disables caching and roughly 5–10×s input cost.

## What lives where

**Stable prefix** — `BuildStableSystem` in `agent/internal/loop/loop.go`:
- Mode base prompt (from embedded `agent/internal/prompts/<mode>.md`).
- `_output_conventions.md` (shared).
- Tool catalogue (one-liners) + per-tool description bodies.
- **Skills catalogue lines only** (id + synopsis + triggers — no bodies).
- Sub-agent preset advertisements (name + description) — only when
  `spawn_subagent` is in the registry.

**Volatile tail** — `BuildVolatileSystem`:
- Workspace root path.
- Index state (files scanned, semantic search status).
- **Loaded skill bodies** (only those the model called `load_skill` on).
- `.loomrules` content (wrapped in `<rules>` XML, 32 KB cap).

**Cache breakpoints** — `agent/internal/llm/anthropic.go`:
- After the stable system prefix.
- After the full tool-definitions block.
- Prior user turn + current user turn (set by `markAnthropicUserBreakpoints`).

OpenAI uses automatic prefix-based caching — no explicit markers, but the
same byte-stability rules apply.

## Rules

1. **Never put per-turn-variable data in the stable prefix.** Timestamps,
   workspace paths, file counters, anything reading workspaceState — these
   all go in the volatile tail.

2. **Tool list order must be deterministic.** MCP tools are sorted by name in
   `Driver.registry()`. If you add a new source of tools, sort it the same
   way before appending.

3. **Skills are advertised, not loaded.** Adding a skill body to the
   catalogue lines = cache invalidation on every load. Keep bodies in the
   volatile tail behind `load_skill`.

4. **Adding a tool invalidates the cache once.** That's expected. But
   re-ordering the existing tools invalidates it on every turn from then
   on — don't shuffle without a reason.

5. **The rules bundle hash is captured at task start.** Mid-task `.loomrules`
   edits do not invalidate the running cache (the Entry holds the snapshot).
   Editing rules between tasks is fine — it's a volatile-tail change anyway.

## Verifying cache behavior

After a change that touches the prefix:
1. Run a multi-turn task (3+ turns).
2. Look at LLM call telemetry / response headers. Anthropic returns
   `cache_read_input_tokens` and `cache_creation_input_tokens` per call.
3. Expected pattern: turn 1 creates the cache, turns 2..N read it. If
   every turn shows fresh creation tokens, the prefix is drifting.

## When you must change the prefix

- Bump prompt revision (`agent/internal/prompts/<mode>.md`) — add an entry
  to `docs/prompt-changelog.md` per project convention.
- Tools added/removed/reordered — document why in the same changelog.
- Mode definition changes — same.
