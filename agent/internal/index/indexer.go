package index

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/your-org/loom/internal/embed"
)

// reindexDebounce coalesces a flurry of file changes into a single rescan.
const reindexDebounce = 250 * time.Millisecond

// StatusNotifier is invoked on every state transition (scanning → ready,
// ready → updating, etc.) and on each batch completion.
type StatusNotifier func(Status)

// Indexer owns a Store and a background walker.
type Indexer struct {
	root     string
	store    *Store
	vectors  *VectorStore   // optional
	embedder embed.Provider // optional
	notify   StatusNotifier
	filesN   atomic.Int64
	state    atomic.Value // string
	startCh  chan struct{}
	dirtyMu  sync.Mutex
	dirty    map[string]struct{}
	dirtySig chan struct{}
}

// New constructs an Indexer rooted at workspaceRoot. notify may be nil.
func New(workspaceRoot string, notify StatusNotifier) *Indexer {
	idx := &Indexer{
		root:     workspaceRoot,
		store:    NewStore(),
		notify:   notify,
		startCh:  make(chan struct{}, 1),
		dirty:    make(map[string]struct{}),
		dirtySig: make(chan struct{}, 1),
	}
	idx.state.Store("scanning")
	return idx
}

// WithEmbeddings attaches an embedder and vector store. Pass nil for either
// to leave embeddings disabled (semantic_search will return a clear error).
func (i *Indexer) WithEmbeddings(p embed.Provider, v *VectorStore) *Indexer {
	i.embedder = p
	i.vectors = v
	return i
}

// Vectors exposes the underlying store for the semantic_search tool.
func (i *Indexer) Vectors() *VectorStore { return i.vectors }

// Root returns the workspace root.
func (i *Indexer) Root() string { return i.root }

// Store returns the underlying symbol store.
func (i *Indexer) Store() *Store { return i.store }

// Status returns a snapshot of the indexer state for the UI.
func (i *Indexer) Status() Status {
	files, syms := i.store.Counts()
	state, _ := i.state.Load().(string)
	return Status{
		State:         state,
		FilesScanned:  files,
		SymbolsCount:  syms,
		WorkspaceRoot: i.root,
		Engine:        engineName,
	}
}

// Start runs the initial scan and then watches the dirty queue for
// invalidations. Returns when ctx is done.
func (i *Indexer) Start(ctx context.Context) {
	if i.root == "" {
		i.state.Store("disabled")
		i.emitStatus()
		return
	}
	i.state.Store("scanning")
	i.emitStatus()
	i.fullScan(ctx)
	i.state.Store("ready")
	i.emitStatus()

	debounce := time.NewTimer(time.Hour)
	debounce.Stop()
	pending := false
	for {
		select {
		case <-ctx.Done():
			return
		case <-i.dirtySig:
			if !pending {
				debounce.Reset(reindexDebounce)
				pending = true
			}
		case <-debounce.C:
			pending = false
			i.drainDirty(ctx)
		}
	}
}

// Invalidate queues files for re-indexing. Safe to call from any goroutine.
func (i *Indexer) Invalidate(paths []string) {
	i.dirtyMu.Lock()
	for _, p := range paths {
		i.dirty[filepath.ToSlash(p)] = struct{}{}
	}
	i.dirtyMu.Unlock()
	select {
	case i.dirtySig <- struct{}{}:
	default:
	}
}

func (i *Indexer) drainDirty(ctx context.Context) {
	i.dirtyMu.Lock()
	pending := i.dirty
	i.dirty = make(map[string]struct{})
	i.dirtyMu.Unlock()
	if len(pending) == 0 {
		return
	}
	i.state.Store("updating")
	i.emitStatus()
	for rel := range pending {
		if ctx.Err() != nil {
			return
		}
		i.reindexOne(rel)
	}
	i.state.Store("ready")
	i.emitStatus()
}

func (i *Indexer) reindexOne(rel string) {
	abs := filepath.Join(i.root, filepath.FromSlash(rel))
	if _, err := os.Stat(abs); err != nil {
		// File deleted — drop from index.
		i.store.ReplaceFile(rel, nil, nil)
		if i.vectors != nil {
			_ = i.vectors.ReplaceFileChunks(rel, nil, nil)
		}
		return
	}
	if !supportedExt(rel) {
		return
	}
	content, err := os.ReadFile(abs)
	if err != nil {
		return
	}
	syms, refs := parseFile(abs, rel, content)
	i.store.ReplaceFile(rel, syms, refs)
	i.embedFile(rel, string(content))
}

// embedFile chunks the file and pushes vectors to the store. Best-effort:
// errors are logged but do not block indexing.
func (i *Indexer) embedFile(rel, content string) {
	if i.embedder == nil || i.vectors == nil {
		return
	}
	chunks := ChunkFile(content, 40, 10)
	if len(chunks) == 0 {
		return
	}
	texts := make([]string, len(chunks))
	for j, c := range chunks {
		texts[j] = c.Content
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	vecs, err := i.embedder.Embed(ctx, texts)
	if err != nil {
		log.Printf("index: embed %s: %v", rel, err)
		return
	}
	if err := i.vectors.ReplaceFileChunks(rel, chunks, vecs); err != nil {
		log.Printf("index: vectors %s: %v", rel, err)
	}
}

func (i *Indexer) fullScan(ctx context.Context) {
	err := walkWorkspace(i.root, func(abs, rel string) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		content, err := os.ReadFile(abs)
		if err != nil {
			return nil
		}
		syms, refs := parseFile(abs, rel, content)
		i.store.ReplaceFile(rel, syms, refs)
		i.embedFile(rel, string(content))
		i.filesN.Add(1)
		return nil
	})
	if err != nil && err != context.Canceled {
		log.Printf("index: walk error: %v", err)
	}
}

func (i *Indexer) emitStatus() {
	if i.notify == nil {
		return
	}
	i.notify(i.Status())
}
