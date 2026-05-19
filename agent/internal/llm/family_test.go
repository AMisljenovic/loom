package llm

import "testing"

func TestOpenAIProviderFamily(t *testing.T) {
	cases := []struct {
		model string
		want  string
	}{
		{"gpt-5.4", "openai"},
		{"gpt-4o-mini", "openai"},
		{"o4-mini", "openai"},
		{"gemini-2.5-pro", "gemini"},
		{"gemini-1.5-flash", "gemini"},
		{"Gemini-2.0-Pro", "gemini"},
		{"models/gemini-2.5-pro", "gemini"},
		{"", "openai"},
	}
	for _, tc := range cases {
		t.Run(tc.model, func(t *testing.T) {
			p := &openaiProvider{model: tc.model}
			if got := p.Family(); got != tc.want {
				t.Fatalf("Family(%q) = %q, want %q", tc.model, got, tc.want)
			}
		})
	}
}
