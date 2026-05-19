package loop

import "github.com/your-org/loom/internal/llm"

// safeCutBoundary walks the proposed summarization cut back so the kept tail
// (messages[cut:]) never begins with a RoleTool message and the summarized
// prefix never ends on an assistant message that emitted tool calls whose
// results live in the tail. Either case would break the
// assistant(tool_calls) -> tool... pairing that OpenAI/Azure require on the
// wire. Returns the adjusted cut; may return 0 to signal "do not summarize
// this turn".
func safeCutBoundary(messages []llm.Message, cut int) int {
	if cut <= 0 || cut >= len(messages) {
		return cut
	}
	for cut > 0 {
		if messages[cut].Role == llm.RoleTool {
			cut--
			continue
		}
		last := messages[cut-1]
		if last.Role == llm.RoleAssistant && len(last.ToolCalls) > 0 {
			cut--
			continue
		}
		break
	}
	return cut
}
