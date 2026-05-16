---
name: ask_questions
category: question
requires_approval: false
---

## Purpose
Ask the user structured clarification questions and wait for answers before continuing.

## When to use
- A plan depends on user intent, scope, priority, audience, or a trade-off you cannot infer from the workspace.
- You need one or more concrete choices before producing a final plan.
- The user has asked for a planning workflow and missing decisions would materially change the implementation.

## When NOT to use
- The answer can be discovered by reading files, docs, settings, or command output.
- A reasonable assumption is low-risk and can be stated in the final response.
- You are in the middle of implementation and can proceed safely without blocking the user.

## Input
- `title` is an optional short heading for the question group.
- `questions` is the list of decisions to collect. Keep it short and only ask high-impact questions.
- Each question needs a stable `id`, user-facing `question`, `kind` of `single` or `multiple`, and concrete `options`.
- Each option needs a stable `id`, concise `label`, and optional one-sentence `description`.

## Behavior
The host renders these questions as an interactive form. The UI always adds an
`Other` option with a free-text field, so do not include your own Other option.
Execution pauses until the user submits answers, then the tool result returns a
JSON summary of selected option labels and any free-text answers.

## Examples

```json
{
  "title": "Plan decisions",
  "questions": [
    {
      "id": "audience",
      "question": "Who should the documentation target?",
      "kind": "single",
      "options": [
        { "id": "users", "label": "End users", "description": "Focus on workflows and outcomes." },
        { "id": "developers", "label": "Developers", "description": "Focus on architecture and APIs." }
      ]
    }
  ]
}
```
