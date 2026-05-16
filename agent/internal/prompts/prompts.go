package prompts

import "embed"

// FS holds the mode prompts. Files whose names begin with `_` are excluded
// from `*.md` (Go's embed pattern resolution), so `_template.md` and
// `_output_conventions.md` are not loadable as modes.
//
//go:embed *.md
var FS embed.FS

// sharedFS holds the shared documentation prompts that are not modes.
// Explicit file names bypass the underscore exclusion that applies to `*`.
//
//go:embed _output_conventions.md
var sharedFS embed.FS

// Load returns the contents of the prompt file for the given mode id.
// Returns an error if the file does not exist (e.g. unknown id).
func Load(id string) (string, error) {
	b, err := FS.ReadFile(id + ".md")
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// OutputConventions returns the shared output-formatting rules injected into
// the stable system prefix on every task. Identical across modes.
func OutputConventions() string {
	b, err := sharedFS.ReadFile("_output_conventions.md")
	if err != nil {
		// Embedded at build time; the only way this fails is if the file is
		// removed without updating the embed directive.
		return ""
	}
	return string(b)
}
