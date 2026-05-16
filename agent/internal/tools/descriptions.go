package tools

import (
	"embed"
	"fmt"
	"sort"
	"strings"
	"sync"
)

// descriptionsFS holds the per-tool Markdown description files. The `_template.md`
// file is intentionally excluded from `*.md` (Go embed ignores files starting
// with `_`); it is documentation only.
//
//go:embed descriptions/*.md
var descriptionsFS embed.FS

// MaxDescriptionWords caps each tool's full description body. The cap exists
// because the bodies are injected into the stable system prefix on every task
// and bloat there hits every conversation.
const MaxDescriptionWords = 400

// Description is the structured form of a tool's documentation.
type Description struct {
	Name             string
	Category         string
	RequiresApproval bool
	Purpose          string // contents of "## Purpose" — one-liner for the tool catalogue
	Body             string // full markdown after the front matter
}

var (
	descriptionsOnce sync.Once
	descriptionsMap  map[string]Description
	descriptionsErr  error
)

// Descriptions returns the loaded per-tool description map keyed by tool
// name. Bodies are validated against MaxDescriptionWords. The result is
// cached after the first call.
func Descriptions() (map[string]Description, error) {
	descriptionsOnce.Do(func() {
		descriptionsMap, descriptionsErr = loadDescriptions()
	})
	return descriptionsMap, descriptionsErr
}

func loadDescriptions() (map[string]Description, error) {
	entries, err := descriptionsFS.ReadDir("descriptions")
	if err != nil {
		return nil, fmt.Errorf("read descriptions dir: %w", err)
	}
	out := make(map[string]Description, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		// Files starting with `_` are documentation only (e.g. _template.md).
		// Go's embed pattern picks them up when the glob is `descriptions/*.md`;
		// the underscore-skip only applies to bare `*`. Filter explicitly.
		if strings.HasPrefix(e.Name(), "_") {
			continue
		}
		data, err := descriptionsFS.ReadFile("descriptions/" + e.Name())
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", e.Name(), err)
		}
		d, err := parseDescription(string(data))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", e.Name(), err)
		}
		fileBase := strings.TrimSuffix(e.Name(), ".md")
		if d.Name != fileBase {
			return nil, fmt.Errorf("%s: front-matter name %q does not match filename", e.Name(), d.Name)
		}
		if words := countWords(d.Body); words > MaxDescriptionWords {
			return nil, fmt.Errorf("%s: body has %d words, exceeds cap %d", e.Name(), words, MaxDescriptionWords)
		}
		out[d.Name] = d
	}
	return out, nil
}

// parseDescription extracts the front matter and body from a description file.
func parseDescription(text string) (Description, error) {
	const delim = "---"
	trim := strings.TrimLeft(text, "\r\n ")
	if !strings.HasPrefix(trim, delim) {
		return Description{}, fmt.Errorf("missing front matter")
	}
	rest := strings.TrimPrefix(trim, delim)
	end := strings.Index(rest, delim)
	if end < 0 {
		return Description{}, fmt.Errorf("unterminated front matter")
	}
	frontMatter := rest[:end]
	body := strings.TrimLeft(rest[end+len(delim):], "\r\n")

	var d Description
	for _, line := range strings.Split(frontMatter, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		colon := strings.IndexByte(line, ':')
		if colon < 0 {
			continue
		}
		key := strings.TrimSpace(line[:colon])
		val := strings.TrimSpace(line[colon+1:])
		switch strings.ToLower(key) {
		case "name":
			d.Name = val
		case "category":
			d.Category = val
		case "requires_approval":
			d.RequiresApproval = strings.EqualFold(val, "true")
		}
	}
	if d.Name == "" {
		return Description{}, fmt.Errorf("front matter missing required field 'name'")
	}
	d.Body = body
	d.Purpose = extractPurpose(body)
	if d.Purpose == "" {
		return Description{}, fmt.Errorf("body missing '## Purpose' section")
	}
	return d, nil
}

// extractPurpose returns the prose under "## Purpose", joined across soft
// line breaks until the next blank line or the next header. The catalogue
// uses this as the tool's one-liner.
func extractPurpose(body string) string {
	const header = "## Purpose"
	idx := strings.Index(body, header)
	if idx < 0 {
		return ""
	}
	after := body[idx+len(header):]
	var lines []string
	started := false
	for _, raw := range strings.Split(after, "\n") {
		s := strings.TrimSpace(raw)
		if !started {
			if s == "" {
				continue
			}
			if strings.HasPrefix(s, "## ") {
				return "" // empty Purpose section
			}
			started = true
			lines = append(lines, s)
			continue
		}
		if s == "" || strings.HasPrefix(s, "## ") {
			break
		}
		lines = append(lines, s)
	}
	return strings.Join(lines, " ")
}

// stripPurposeSection returns the body with the "## Purpose" section removed.
// Used when rendering the per-tool detail block so the one-liner is not
// duplicated inside an H3-tool / H2-Purpose nesting.
func stripPurposeSection(body string) string {
	const header = "## Purpose"
	idx := strings.Index(body, header)
	if idx < 0 {
		return body
	}
	after := body[idx+len(header):]
	next := strings.Index(after, "\n## ")
	if next < 0 {
		return strings.TrimSpace(body[:idx])
	}
	return strings.TrimSpace(body[:idx]) + "\n\n" + strings.TrimLeft(after[next+1:], "\n")
}

func countWords(s string) int {
	return len(strings.Fields(s))
}

// ValidateRegistry checks that every tool in the registry has a matching
// description file. Extra description files are tolerated only for tools
// outside the static registry (none today). Tools without a Description
// entry are reported as errors.
func ValidateRegistry(registry []Tool) error {
	descs, err := Descriptions()
	if err != nil {
		return err
	}
	var missing []string
	for _, t := range registry {
		if _, ok := descs[t.Name]; !ok {
			missing = append(missing, t.Name)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return fmt.Errorf("tools missing description files: %s", strings.Join(missing, ", "))
	}
	return nil
}

// DescriptionBodies returns the per-tool full Markdown bodies, concatenated
// in the registry's order, for tools that have a description file. Tools
// without a description (e.g. dynamically-registered MCP or index tools)
// are silently skipped. The returned string is empty when no tool in the
// registry has a description.
//
// Intended for injection into the stable system prefix under a "Tool details"
// section so the model can see richer guidance without the Go literals being
// bloated.
func DescriptionBodies(registry []Tool) string {
	descs, err := Descriptions()
	if err != nil || len(descs) == 0 {
		return ""
	}
	var b strings.Builder
	for _, t := range registry {
		d, ok := descs[t.Name]
		if !ok {
			continue
		}
		if b.Len() > 0 {
			b.WriteString("\n\n")
		}
		fmt.Fprintf(&b, "### %s — %s\n\n", t.Name, d.Purpose)
		b.WriteString(strings.TrimSpace(stripPurposeSection(d.Body)))
	}
	return b.String()
}
