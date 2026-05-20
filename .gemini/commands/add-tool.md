---
description: Add a new tool the AI agent can call
argument-hint: <tool_name> <one-line description>
---

Add a new tool named `$1` to this project. Description: $2

Use the `tool-author` subagent for this work.

Steps:

1. Decide Go (`agent/internal/tools/tools.go`) vs TypeScript
   (`src/tools/index.ts`) based on whether it needs the VS Code API.
2. Add the tool definition to `Registry()` with proper `InputSchema`
   and `RequiresApproval`.
3. Implement the executor.
4. Add `agent/internal/tools/descriptions/<tool>.md`.
5. Update the system prompt in `agent/internal/loop/loop.go` if
   needed.
6. Run `npm run build`.
7. Record the prompt change in `docs/prompt-changelog.md`.
8. Explain how to test in the Extension Development Host.

Default to `RequiresApproval: true` for any write or execution.
