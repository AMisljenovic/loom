package loop

import (
	"context"
	"encoding/json"

	"github.com/your-org/loom/internal/conversation"
	"github.com/your-org/loom/internal/skills"
)

// localInterceptor handles a tool call that the loop services in-process
// rather than dispatching through the standard tools.Tool.LocalExec path.
// These tools (currently load_skill, scratchpad, spawn_subagent) mutate
// conversation state or fan out new tasks and therefore need state the
// generic LocalExec signature deliberately doesn't carry — the per-task
// skills catalogue, the preset registry, the conversation Entry, etc.
//
// Registering each interceptor in a map keeps the per-tool wiring out of
// execOneTool's switch, so adding a new state-mutating tool is one map
// entry rather than a new switch arm.
type localInterceptor func(
	ctx context.Context,
	taskID, conversationID string,
	entry *conversation.Entry,
	input json.RawMessage,
) toolOutcome

// buildInterceptors constructs the per-task interceptor map. The catalogue
// and preset registry are captured by reference because both are frozen
// at task start (see CLAUDE.md "skills/presets are frozen at task start").
// The driver is captured via the method receiver so the map closures can
// reach driver-owned dependencies (workspace root, sub-agent dispatch).
func (d *Driver) buildInterceptors(catalogue skills.Catalogue, presets Registry) map[string]localInterceptor {
	return map[string]localInterceptor{
		"load_skill": func(_ context.Context, _, _ string, entry *conversation.Entry, input json.RawMessage) toolOutcome {
			return execLoadSkill(entry, catalogue, input)
		},
		"scratchpad": func(_ context.Context, _, conversationID string, entry *conversation.Entry, input json.RawMessage) toolOutcome {
			return execScratchpad(d.WorkspaceRoot, entry, conversationID, input)
		},
		"spawn_subagent": func(ctx context.Context, taskID, conversationID string, _ *conversation.Entry, input json.RawMessage) toolOutcome {
			return d.execSpawnSubAgent(ctx, taskID, conversationID, input, presets)
		},
	}
}
