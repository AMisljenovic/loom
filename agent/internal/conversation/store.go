package conversation

import (
	"sync"

	"github.com/your-org/loom/internal/llm"
)

type Store struct {
	mu      sync.Mutex
	entries map[string]*Entry
}

type Entry struct {
	mu sync.Mutex

	Messages             []llm.Message
	CumulativeInput      int64
	CumulativeOutput     int64
	CumulativeCacheRead  int64
	CumulativeCacheWrite int64
	LastInputTokens      int64
	LastOutputTokens     int64
	LastSummarizedLen    int

	// LoadedSkills holds the ids of skills the model has requested via the
	// load_skill tool during this conversation. The skills' bodies are
	// rendered into the volatile tail of the system prompt; the cached
	// prefix is unaffected so cache hits continue to grow.
	LoadedSkills []string
	// RulesHash is the SHA-256 of the rules bundle captured at task.start.
	// Used to detect drift across turns and is frozen for the task lifetime.
	RulesHash string
}

// LoadSkills appends previously-unseen ids to LoadedSkills, preserving order
// of first appearance. Returns the ids that were newly added (in order).
func (e *Entry) LoadSkills(ids []string) []string {
	seen := make(map[string]bool, len(e.LoadedSkills))
	for _, id := range e.LoadedSkills {
		seen[id] = true
	}
	var added []string
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		e.LoadedSkills = append(e.LoadedSkills, id)
		added = append(added, id)
	}
	return added
}

type Snapshot struct {
	Messages             []llm.Message `json:"messages"`
	CumulativeInput      int64         `json:"cumulativeInput"`
	CumulativeOutput     int64         `json:"cumulativeOutput"`
	CumulativeCacheRead  int64         `json:"cumulativeCacheRead,omitempty"`
	CumulativeCacheWrite int64         `json:"cumulativeCacheWrite,omitempty"`
	LastInputTokens      int64         `json:"lastInputTokens"`
	LastOutputTokens     int64         `json:"lastOutputTokens"`
}

func NewStore() *Store {
	return &Store{entries: make(map[string]*Entry)}
}

func (s *Store) Get(id string) *Entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	if entry, ok := s.entries[id]; ok {
		return entry
	}
	entry := &Entry{}
	s.entries[id] = entry
	return entry
}

func (s *Store) Reset(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.entries, id)
}

func (s *Store) Hydrate(id string, snap Snapshot) {
	entry := s.Get(id)
	entry.mu.Lock()
	defer entry.mu.Unlock()
	entry.Messages = cloneMessages(snap.Messages)
	entry.CumulativeInput = snap.CumulativeInput
	entry.CumulativeOutput = snap.CumulativeOutput
	entry.CumulativeCacheRead = snap.CumulativeCacheRead
	entry.CumulativeCacheWrite = snap.CumulativeCacheWrite
	entry.LastInputTokens = snap.LastInputTokens
	entry.LastOutputTokens = snap.LastOutputTokens
}

func (e *Entry) Lock() {
	e.mu.Lock()
}

func (e *Entry) Unlock() {
	e.mu.Unlock()
}

func (e *Entry) Append(messages ...llm.Message) {
	e.Messages = append(e.Messages, messages...)
}

func (e *Entry) Snapshot() Snapshot {
	return Snapshot{
		Messages:             cloneMessages(e.Messages),
		CumulativeInput:      e.CumulativeInput,
		CumulativeOutput:     e.CumulativeOutput,
		CumulativeCacheRead:  e.CumulativeCacheRead,
		CumulativeCacheWrite: e.CumulativeCacheWrite,
		LastInputTokens:      e.LastInputTokens,
		LastOutputTokens:     e.LastOutputTokens,
	}
}

func (e *Entry) AddUsage(usage llm.TokenUsage) {
	e.LastInputTokens = usage.InputTokens
	e.LastOutputTokens = usage.OutputTokens
	e.CumulativeInput += usage.InputTokens
	e.CumulativeOutput += usage.OutputTokens
	e.CumulativeCacheRead += usage.CacheReadTokens
	e.CumulativeCacheWrite += usage.CacheCreationTokens
}

func cloneMessages(messages []llm.Message) []llm.Message {
	out := make([]llm.Message, len(messages))
	for i, m := range messages {
		out[i] = m
		if len(m.ToolCalls) > 0 {
			out[i].ToolCalls = append([]llm.ToolCall(nil), m.ToolCalls...)
		}
		if len(m.Images) > 0 {
			out[i].Images = append([]llm.Image(nil), m.Images...)
		}
	}
	return out
}
