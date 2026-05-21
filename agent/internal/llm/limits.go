package llm

import "strings"

const (
	defaultContextTokens int64 = 200_000
	gpt5FallbackTokens   int64 = 400_000
)

func ModelContextLimit(model string) int64 {
	m := strings.ToLower(strings.TrimSpace(model))
	switch m {
	case "claude-opus-4-7", "claude-sonnet-4-6":
		return 1_000_000
	case "claude-haiku-4-5", "claude-haiku-4-5-20251001":
		return 200_000
	case "gpt-5.1", "gpt-5.1-mini", "gpt-5.4", "o5", "o5-mini":
		return 400_000
	}
	// Prefix fall-through so future gpt-5.x / o5 / gpt-6 variants the user
	// adopts aren't stranded at the 200K default that triggers
	// over-aggressive summarization. Explicit cases above still win.
	if strings.HasPrefix(m, "gpt-5") || strings.HasPrefix(m, "gpt-6") || strings.HasPrefix(m, "o5") {
		return gpt5FallbackTokens
	}
	return defaultContextTokens
}
