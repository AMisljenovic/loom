package llm

import "strings"

const defaultContextTokens int64 = 200_000

func ModelContextLimit(model string) int64 {
	switch strings.ToLower(strings.TrimSpace(model)) {
	case "claude-opus-4-7", "claude-sonnet-4-6":
		return 1_000_000
	case "claude-haiku-4-5", "claude-haiku-4-5-20251001":
		return 200_000
	default:
		return defaultContextTokens
	}
}
