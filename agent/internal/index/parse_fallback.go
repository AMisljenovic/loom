//go:build !cgo

package index

// parseFile is the pure-Go fallback used when CGO is disabled. It returns
// empty symbol and reference lists. The walker and store still operate so
// the indexer reports "ready" with zero symbols, and downstream tools degrade
// gracefully (find_symbol returns no matches instead of erroring).
func parseFile(absPath, relPath string, content []byte) (symbols []Symbol, refs []Reference) {
	return nil, nil
}

// engineName is reported in the status notification.
const engineName = "fallback"
