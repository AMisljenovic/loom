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

func TestLoadTestScoutPrompt(t *testing.T) {
	body, err := Load("test-scout")
	if err != nil {
		t.Fatalf("Load(test-scout): %v", err)
	}
	for _, want := range []string{"test-coverage scout", "**Existing Coverage**", "**Missing Scenarios**", "**Risk**", "**Unverified**"} {
		if !strings.Contains(body, want) {
			t.Fatalf("test-scout prompt missing %q", want)
		}
	}
}

func TestLoadArchitectureMapperPrompt(t *testing.T) {
	body, err := Load("architecture-mapper")
	if err != nil {
		t.Fatalf("Load(architecture-mapper): %v", err)
	}
	for _, want := range []string{"architecture mapper", "**Target**", "**Layers**", "**Public Surface**", "**Dependencies**", "**Cycles**", "**Unverified**"} {
		if !strings.Contains(body, want) {
			t.Fatalf("architecture-mapper prompt missing %q", want)
		}
	}
}
