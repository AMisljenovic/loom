package index

import (
	"strings"
	"sync"
)

// Store holds the in-memory index: per-path symbol lists plus a name-keyed
// inverted index for fast find_symbol lookup. All access is mutex-guarded.
type Store struct {
	mu      sync.RWMutex
	byPath  map[string][]Symbol
	byName  map[string][]Symbol
	byPathR map[string][]Reference
	byNameR map[string][]Reference
}

func NewStore() *Store {
	return &Store{
		byPath:  make(map[string][]Symbol),
		byName:  make(map[string][]Symbol),
		byPathR: make(map[string][]Reference),
		byNameR: make(map[string][]Reference),
	}
}

// ReplaceFile swaps the symbol and reference list for one file, updating
// both indices atomically.
func (s *Store) ReplaceFile(path string, symbols []Symbol, refs []Reference) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if old, ok := s.byPath[path]; ok {
		for _, sym := range old {
			s.removeFromNameIndex(sym)
		}
	}
	if symbols == nil {
		delete(s.byPath, path)
	} else {
		s.byPath[path] = symbols
		for _, sym := range symbols {
			s.byName[sym.Name] = append(s.byName[sym.Name], sym)
		}
	}
	if old, ok := s.byPathR[path]; ok {
		for _, r := range old {
			s.removeFromNameRefIndex(r)
		}
	}
	if refs == nil {
		delete(s.byPathR, path)
	} else {
		s.byPathR[path] = refs
		for _, r := range refs {
			s.byNameR[r.Name] = append(s.byNameR[r.Name], r)
		}
	}
}

func (s *Store) removeFromNameIndex(sym Symbol) {
	list := s.byName[sym.Name]
	for i, x := range list {
		if x.Path == sym.Path && x.StartLine == sym.StartLine {
			s.byName[sym.Name] = append(list[:i], list[i+1:]...)
			break
		}
	}
	if len(s.byName[sym.Name]) == 0 {
		delete(s.byName, sym.Name)
	}
}

func (s *Store) removeFromNameRefIndex(r Reference) {
	list := s.byNameR[r.Name]
	for i, x := range list {
		if x.Path == r.Path && x.Line == r.Line {
			s.byNameR[r.Name] = append(list[:i], list[i+1:]...)
			break
		}
	}
	if len(s.byNameR[r.Name]) == 0 {
		delete(s.byNameR, r.Name)
	}
}

// LookupSymbol returns symbols matching the given name (and optional kind,
// path-prefix filters).
func (s *Store) LookupSymbol(name string, kind Kind, pathPrefix string) []Symbol {
	s.mu.RLock()
	defer s.mu.RUnlock()
	candidates := s.byName[name]
	if len(candidates) == 0 {
		return nil
	}
	out := make([]Symbol, 0, len(candidates))
	for _, sym := range candidates {
		if kind != "" && sym.Kind != kind {
			continue
		}
		if pathPrefix != "" && !strings.HasPrefix(sym.Path, pathPrefix) {
			continue
		}
		out = append(out, sym)
	}
	return out
}

// LookupReferences returns identifier occurrences matching name.
func (s *Store) LookupReferences(name string, pathPrefix string) []Reference {
	s.mu.RLock()
	defer s.mu.RUnlock()
	candidates := s.byNameR[name]
	if len(candidates) == 0 {
		return nil
	}
	out := make([]Reference, 0, len(candidates))
	for _, r := range candidates {
		if pathPrefix != "" && !strings.HasPrefix(r.Path, pathPrefix) {
			continue
		}
		out = append(out, r)
	}
	return out
}

// Counts returns (fileCount, symbolCount).
func (s *Store) Counts() (int, int) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	n := 0
	for _, syms := range s.byPath {
		n += len(syms)
	}
	return len(s.byPath), n
}
