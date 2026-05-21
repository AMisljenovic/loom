package prompts

import (
	"strings"
	"testing"
)

func TestLoadReviewPrompt(t *testing.T) {
	body, err := Load("review")
	if err != nil {
		t.Fatalf("Load(review): %v", err)
	}
	for _, want := range []string{"review sub-agent", "**Findings**", "**Test Gaps**"} {
		if !strings.Contains(body, want) {
			t.Fatalf("review prompt missing %q", want)
		}
	}
}
