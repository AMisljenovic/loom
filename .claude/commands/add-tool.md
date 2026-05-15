---
description: Add a new tool the AI agent can call
argument-hint: <tool_name> <one-line description>
---

Add a new tool named `$1` to this project. Description: $2

Use the `tool-author` subagent for this work.

Steps:

1. Decide whether this tool runs in Go (`agent/internal/tools/tools.go`) or
   TypeScript (`src/tools/index.ts`) based on whether it needs the VS Code API.
2. Add the tool definition to `Registry()` in `agent/internal/tools/tools.go`
   with a proper `InputSchema` and `RequiresApproval` set correctly.
3. Implement the executor on the chosen side.
4. Update the system prompt in `agent/internal/loop/loop.go` to mention the
   new tool.
5. Run `npm run build` and verify it compiles.
6. Briefly explain to me how to test it in the Extension Development Host.

Default to `RequiresApproval: true` if the tool writes or executes anything.
