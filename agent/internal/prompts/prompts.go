package prompts

import "embed"

//go:embed *.md
var FS embed.FS

// Load returns the contents of the prompt file for the given mode id.
// Returns an error if the file does not exist (e.g. unknown id).
func Load(id string) (string, error) {
	b, err := FS.ReadFile(id + ".md")
	if err != nil {
		return "", err
	}
	return string(b), nil
}
