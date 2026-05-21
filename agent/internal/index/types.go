// Package index maintains a workspace symbol index. The indexer walks the
// workspace honoring .gitignore, extracts symbols per language, and serves
// find_symbol / find_references queries.
//
// Symbol extraction uses tree-sitter (CGO build) when available; with the
// pure-Go build tag (!cgo) it falls back to an empty extractor that still
// keeps the file walk and ignore plumbing intact, so the rest of the agent
// works without the C toolchain.
package index

// Kind classifies a symbol. Keep this set small and language-agnostic.
type Kind string

const (
	KindFunction  Kind = "function"
	KindMethod    Kind = "method"
	KindType      Kind = "type"
	KindInterface Kind = "interface"
	KindClass     Kind = "class"
	KindVariable  Kind = "variable"
	KindConstant  Kind = "constant"
)

// Symbol is one entry in the index.
type Symbol struct {
	Name      string `json:"name"`
	Kind      Kind   `json:"kind"`
	Path      string `json:"path"`
	StartLine int    `json:"startLine"`
	EndLine   int    `json:"endLine"`
}

// Reference is an identifier occurrence in source.
type Reference struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Line int    `json:"line"`
}

// Status describes the indexer's current state for the UI.
type Status struct {
	State         string `json:"state"` // "scanning" | "ready" | "updating" | "disabled"
	FilesScanned  int    `json:"filesScanned"`
	SymbolsCount  int    `json:"symbolsCount"`
	WorkspaceRoot string `json:"workspaceRoot,omitempty"`
	Engine        string `json:"engine,omitempty"` // "tree-sitter" | "fallback"
}
