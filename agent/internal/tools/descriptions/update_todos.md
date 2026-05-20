---
name: update_todos
category: read
requires_approval: false
---

## Purpose
Update the live todo checklist shown in the transcript for the current task.

## When to use
- You have two or more concrete implementation or debugging steps.
- You are starting, completing, cancelling, or reordering work that the user
  should see progress on.
- You are implementing selected Architect plan steps.

## When NOT to use
- For a single trivial action.
- To summarize final results; write the final assistant response instead.

## Input
- `title` (string, optional) — short checklist heading.
- `items` (array, required) — full current checklist, each with `id`, `text`,
  and `status`.
- `status` must be `pending`, `in_progress`, `done`, or `cancelled`.

## Behavior
- Send the complete checklist every time; the UI replaces the previous list
  for this task.
- Keep exactly one item `in_progress` while work is actively underway.
- Use stable `id` values so items update in place.
- If the task prompt includes `<implementation_todos>`, preserve those exact
  item `id` and `text` values in the same order; update only `status`. Work
  through every seeded item before the final response unless a blocker makes
  an item impossible, in which case mark it `cancelled` and explain why.

## Examples

```json
{"title":"Update Todos","items":[{"id":"read","text":"Read current settings UI","status":"in_progress"},{"id":"patch","text":"Patch compact provider selector","status":"pending"}]}
```

Start a visible checklist.
