package skills

import (
	"strings"
	"testing"
)

// MaxSkillBodyWords is a soft cap on builtin skill bodies. Workspace skills
// in `.loom/skills/` are user-authored and not checked.
const MaxSkillBodyWords = 800

func TestBuiltinSkillsLoad(t *testing.T) {
	cat := Load("")
	if len(cat.Order) == 0 {
		t.Fatal("no skills loaded")
	}
	expected := map[string]bool{
		"go-conventions":            false,
		"testing":                   false,
		"vscode-api":                false,
		"react-conventions":         false,
		"typescript-strict":         false,
		"error-handling":            false,
		"git-workflow":              false,
		"performance-investigation": false,
	}
	for _, id := range cat.Order {
		if _, ok := expected[id]; ok {
			expected[id] = true
		}
		s := cat.Skills[id]
		if s.Synopsis == "" {
			t.Errorf("%s: empty synopsis", id)
		}
		if len(s.Triggers) == 0 {
			t.Errorf("%s: no triggers", id)
		}
		if w := len(strings.Fields(s.Body)); w > MaxSkillBodyWords {
			t.Errorf("%s: body has %d words, exceeds soft cap %d", id, w, MaxSkillBodyWords)
		}
	}
	for id, found := range expected {
		if !found {
			t.Errorf("expected builtin skill %q not present", id)
		}
	}
}

func TestCatalogueLinesIncludeTriggers(t *testing.T) {
	cat := Load("")
	lines := cat.CatalogueLines()
	for _, line := range lines {
		if !strings.Contains(line, "[triggers:") {
			t.Errorf("catalogue line missing triggers: %q", line)
		}
	}
}
