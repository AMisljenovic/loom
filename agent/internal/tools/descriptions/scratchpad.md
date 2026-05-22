---
name: scratchpad
category: subtasks
requires_approval: false
---

## Purpose
Read, write, append to, or clear a per-conversation working-memory note that
persists across turns and across reloads of the same conversation.

## When to use
- Multi-step tasks where intermediate findings, hypotheses, or plans would
  otherwise be lost when prior turns get summarized.
- During exploration: jot down file paths, symbol names, or open questions so
  later turns don't repeat searches.
- Before a long edit pass: draft the change plan into the scratchpad and
  re-read it as you work.

## When NOT to use
- For user-visible progress — use `update_todos` instead. The scratchpad is
  agent-internal; the user sees it only if they expand the tool card.
- For permanent project knowledge — that belongs in a skill or rules file.
- For the final answer to the user. Write the answer in the assistant
  message; the scratchpad is for working notes.

## Input
- `action` (string, required) — one of `read`, `write`, `append`, `clear`.
  - `read` returns the current body (empty string on first use).
  - `write` overwrites the body with `content`.
  - `append` adds `content` to the end of the body (with a newline between
    the existing body and the new chunk if the existing body does not end in
    one).
  - `clear` empties the body and removes the on-disk file.
- `content` (string) — required for `write` and `append`. Ignored otherwise.

## Behavior
- Persisted per-conversation. Survives task end and window reload; lives
  only for this conversation. Storage location is host-controlled (VS Code
  routes it to its per-workspace storage path); you do not need to know the
  exact file path.
- Hard size cap is 64 KB. Treat the scratchpad as a working buffer, not a
  log — when it grows past a few KB, consider `write` with a condensed
  rewrite.
- The current body does NOT ride along in the system prompt. You have to
  call `scratchpad` with `action: "read"` to see it again on a later turn.

## Examples

```json
{"action": "write", "content": "## Plan\n1. Rename foo -> bar in src/api.ts\n2. Update tests\n"}
```

Start a fresh plan.

```json
{"action": "append", "content": "- Verified bar() is unused elsewhere via search.\n"}
```

Record a finding without rewriting the whole note.

```json
{"action": "read"}
```

Refresh your working context at the start of a later turn.

```json
{"action": "clear"}
```

Discard the note when the task is finished.
