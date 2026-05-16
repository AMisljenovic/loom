package tools

import (
	"strings"
	"testing"
)

func TestDescriptionsLoad(t *testing.T) {
	descs, err := Descriptions()
	if err != nil {
		t.Fatalf("Descriptions: %v", err)
	}
	if len(descs) == 0 {
		t.Fatal("no descriptions loaded")
	}
	for name, d := range descs {
		if d.Name != name {
			t.Errorf("%s: front-matter name %q does not match key %q", name, d.Name, name)
		}
		if d.Purpose == "" {
			t.Errorf("%s: empty Purpose", name)
		}
		if !strings.Contains(d.Body, "## When to use") {
			t.Errorf("%s: missing 'When to use' section", name)
		}
		if w := countWords(d.Body); w > MaxDescriptionWords {
			t.Errorf("%s: body has %d words, exceeds cap %d", name, w, MaxDescriptionWords)
		}
	}
}

func TestRegistryHasDescriptions(t *testing.T) {
	if err := ValidateRegistry(Registry()); err != nil {
		t.Fatalf("registry validation: %v", err)
	}
}

func TestRegistryDescriptionsAreNonEmpty(t *testing.T) {
	for _, tl := range Registry() {
		if tl.Description == "" {
			t.Errorf("tool %q has empty Description after overlay", tl.Name)
		}
	}
}
