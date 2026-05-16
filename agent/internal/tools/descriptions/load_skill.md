---
name: load_skill
category: read
requires_approval: false
---

## Purpose
Load one or more skills by id. Skill bodies are short topic-specific guides
that persist in your system prompt for the rest of the conversation.

## When to use
- Before working in an area a skill covers (testing, language conventions,
  error handling, performance investigation, etc.).
- When the user's question maps directly to a catalogue skill's topic.

## When NOT to use
- "Just in case" — only load skills whose topic is in scope for the current
  task. Loaded bodies cost tokens on every subsequent turn.
- For information not in the skill catalogue. Skills are curated; if it's
  not listed, it's not available.

## Input
- `ids` (array of strings, required) — one or more skill ids exactly as they
  appear in the catalogue.

## Behavior
- Bodies are injected into the system prompt under `<skill id="...">` tags
  and remain for every subsequent turn in this conversation.
- Unknown ids are silently skipped; check the catalogue for the canonical
  list.
- Loading the same skill twice has no additional effect.

## Examples

```json
{"ids": ["go-conventions"]}
```

Load one skill.

```json
{"ids": ["testing", "error-handling"]}
```

Load several at once before producing code that needs both.
