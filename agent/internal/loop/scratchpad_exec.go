package loop

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/your-org/loom/internal/conversation"
	"github.com/your-org/loom/internal/scratchpad"
)

// execScratchpad services the "scratchpad" tool. It is intercepted in
// execOneTool (alongside load_skill) so it can read/write the conversation
// entry's in-memory copy and the on-disk file under .loom/scratchpad/.
//
// On first call within an Entry's lifetime, the persisted body is loaded
// from disk so a conversation that resumes after a reload picks up where it
// left off.
func execScratchpad(workspaceRoot string, entry *conversation.Entry, conversationID string, input json.RawMessage) toolOutcome {
	var in struct {
		Action  string `json:"action"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return toolOutcome{err: fmt.Errorf("scratchpad: %w", err)}
	}
	action := strings.ToLower(strings.TrimSpace(in.Action))
	if action == "" {
		return toolOutcome{err: fmt.Errorf("scratchpad: action is required")}
	}

	entry.Lock()
	defer entry.Unlock()

	if !entry.ScratchpadLoaded {
		body, err := scratchpad.Load(workspaceRoot, conversationID)
		if err != nil {
			return toolOutcome{err: fmt.Errorf("scratchpad: load: %w", err)}
		}
		entry.Scratchpad = body
		entry.ScratchpadLoaded = true
	}

	switch action {
	case "read":
		if entry.Scratchpad == "" {
			return toolOutcome{content: "scratchpad: empty"}
		}
		return toolOutcome{content: entry.Scratchpad}

	case "write":
		next := in.Content
		if err := scratchpad.Save(workspaceRoot, conversationID, next); err != nil {
			return toolOutcome{err: fmt.Errorf("scratchpad: %w", err)}
		}
		entry.Scratchpad = next
		return toolOutcome{content: fmt.Sprintf("scratchpad: wrote %d bytes", len(next))}

	case "append":
		if in.Content == "" {
			return toolOutcome{err: fmt.Errorf("scratchpad: append requires content")}
		}
		next := entry.Scratchpad
		if next != "" && !strings.HasSuffix(next, "\n") {
			next += "\n"
		}
		next += in.Content
		if err := scratchpad.Save(workspaceRoot, conversationID, next); err != nil {
			return toolOutcome{err: fmt.Errorf("scratchpad: %w", err)}
		}
		entry.Scratchpad = next
		return toolOutcome{content: fmt.Sprintf("scratchpad: appended %d bytes (total %d)", len(in.Content), len(next))}

	case "clear":
		if err := scratchpad.Clear(workspaceRoot, conversationID); err != nil {
			return toolOutcome{err: fmt.Errorf("scratchpad: %w", err)}
		}
		entry.Scratchpad = ""
		return toolOutcome{content: "scratchpad: cleared"}

	default:
		return toolOutcome{err: fmt.Errorf("scratchpad: unknown action %q", in.Action)}
	}
}
