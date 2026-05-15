//go:build cgo

package index

import (
	"context"

	sitter "github.com/smacker/go-tree-sitter"
	tsgolang "github.com/smacker/go-tree-sitter/golang"
	tsjavascript "github.com/smacker/go-tree-sitter/javascript"
	tspython "github.com/smacker/go-tree-sitter/python"
	tstsx "github.com/smacker/go-tree-sitter/typescript/tsx"
	tstypescript "github.com/smacker/go-tree-sitter/typescript/typescript"
)

const engineName = "tree-sitter"

// languageFor returns the tree-sitter language for a given file path.
func languageFor(path string) *sitter.Language {
	switch LanguageFromPath(path) {
	case "go":
		return tsgolang.GetLanguage()
	case "typescript":
		return tstypescript.GetLanguage()
	case "tsx":
		return tstsx.GetLanguage()
	case "javascript":
		return tsjavascript.GetLanguage()
	case "python":
		return tspython.GetLanguage()
	}
	return nil
}

// parseFile parses a source file with tree-sitter and walks the AST to
// extract definition symbols and identifier references. The extractor is
// intentionally simple: it recognizes the most common definition node kinds
// across the supported languages and treats every other identifier as a
// reference.
func parseFile(absPath, relPath string, content []byte) ([]Symbol, []Reference) {
	lang := languageFor(relPath)
	if lang == nil {
		return nil, nil
	}
	parser := sitter.NewParser()
	parser.SetLanguage(lang)
	tree, err := parser.ParseCtx(context.Background(), nil, content)
	if err != nil || tree == nil {
		return nil, nil
	}
	defer tree.Close()
	root := tree.RootNode()

	var symbols []Symbol
	var refs []Reference
	walk(root, content, relPath, &symbols, &refs)
	return symbols, refs
}

// definitionKinds maps tree-sitter node types to our Kind. Cross-language
// node names share enough commonality that one table is workable; missing
// entries are simply skipped.
var definitionKinds = map[string]Kind{
	// Go
	"function_declaration":         KindFunction,
	"method_declaration":           KindMethod,
	"type_declaration":             KindType,
	"const_declaration":            KindConstant,
	"var_declaration":              KindVariable,
	"type_spec":                    KindType,
	"interface_type":               KindInterface,
	"struct_type":                  KindType,
	// TS / JS
	"function_signature":           KindFunction,
	"method_signature":             KindMethod,
	"interface_declaration":        KindInterface,
	"class_declaration":            KindClass,
	"type_alias_declaration":       KindType,
	"enum_declaration":             KindType,
	"method_definition":            KindMethod,
	"function":                     KindFunction,
	"lexical_declaration":          KindVariable,
	"variable_declaration":         KindVariable,
	// Python
	"function_definition":          KindFunction,
	"class_definition":             KindClass,
}

// walk traverses the AST. When it sees a definition node, it records the
// child identifier as a Symbol; identifiers outside definitions become
// References (name-only, no semantic scope).
func walk(node *sitter.Node, src []byte, path string, syms *[]Symbol, refs *[]Reference) {
	if node == nil {
		return
	}
	kind, isDef := definitionKinds[node.Type()]
	if isDef {
		if name, line := findNameChild(node, src); name != "" {
			endLine := int(node.EndPoint().Row) + 1
			*syms = append(*syms, Symbol{
				Name:      name,
				Kind:      kind,
				Path:      path,
				StartLine: line,
				EndLine:   endLine,
			})
		}
	} else if node.Type() == "identifier" || node.Type() == "type_identifier" || node.Type() == "property_identifier" {
		text := node.Content(src)
		if text != "" {
			*refs = append(*refs, Reference{
				Name: text,
				Path: path,
				Line: int(node.StartPoint().Row) + 1,
			})
		}
	}
	for i := 0; i < int(node.ChildCount()); i++ {
		walk(node.Child(i), src, path, syms, refs)
	}
}

// findNameChild returns the textual name of the first identifier-bearing
// child of a definition node. Falls back to scanning for "name" field on
// the node, then to the first identifier descendant.
func findNameChild(node *sitter.Node, src []byte) (string, int) {
	if n := node.ChildByFieldName("name"); n != nil {
		return n.Content(src), int(n.StartPoint().Row) + 1
	}
	for i := 0; i < int(node.ChildCount()); i++ {
		c := node.Child(i)
		if c == nil {
			continue
		}
		switch c.Type() {
		case "identifier", "type_identifier", "property_identifier":
			return c.Content(src), int(c.StartPoint().Row) + 1
		}
	}
	return "", int(node.StartPoint().Row) + 1
}
