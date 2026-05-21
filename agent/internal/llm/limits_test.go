package llm

import "testing"

func TestModelContextLimit(t *testing.T) {
	cases := []struct {
		model string
		want  int64
	}{
		{"claude-opus-4-7", 1_000_000},
		{"claude-sonnet-4-6", 1_000_000},
		{"claude-haiku-4-5", 200_000},
		{"claude-haiku-4-5-20251001", 200_000},
		{"gpt-5.1", 400_000},
		{"gpt-5.1-mini", 400_000},
		{"gpt-5.4", 400_000},
		{"o5", 400_000},
		{"o5-mini", 400_000},
		// Prefix fall-through: unrecognized gpt-5* / gpt-6* / o5* variants
		// fall back to the 400K ceiling instead of the 200K default that
		// triggers over-aggressive summarization.
		{"gpt-5.7-experimental", gpt5FallbackTokens},
		{"gpt-6", gpt5FallbackTokens},
		{"o5-pro", gpt5FallbackTokens},
		{"unknown-model", defaultContextTokens},
		{"gpt-4o", defaultContextTokens},
		{"  gpt-5.1  ", 400_000},
		{"GPT-5.1", 400_000},
		{"", defaultContextTokens},
	}
	for _, c := range cases {
		got := ModelContextLimit(c.model)
		if got != c.want {
			t.Errorf("ModelContextLimit(%q) = %d, want %d", c.model, got, c.want)
		}
	}
}
