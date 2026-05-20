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

	// Scratchpad is the in-memory mirror of the per-conversation scratchpad
	// note. The on-disk source of truth lives at
	// <workspace>/.loom/scratchpad/<conversationId>.md; the loop reads it
	// lazily on first scratchpad-tool call (see ScratchpadLoaded) and writes
	// it back after every mutation.
	Scratchpad string
	// ScratchpadLoaded guards the one-time disk hydration of Scratchpad for
	// this entry's lifetime so repeated tool calls don't re-read the file.
	ScratchpadLoaded bool
}

// LoadSkills appends previously-unseen ids to LoadedSkills, preserving order
// of first appearance. Returns the ids that were newly added (in order).
func (e *Entry) LoadSkills(ids []string) []string {
	e.mu.Lock()
	defer e.mu.Unlock()
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
	entry.Messages = healOrphanToolCalls(cloneMessages(snap.Messages))
	entry.CumulativeInput = snap.CumulativeInput
	entry.CumulativeOutput = snap.CumulativeOutput
	entry.CumulativeCacheRead = snap.CumulativeCacheRead
	entry.CumulativeCacheWrite = snap.CumulativeCacheWrite
	entry.LastInputTokens = snap.LastInputTokens
	entry.LastOutputTokens = snap.LastOutputTokens
}

// healOrphanToolCalls repairs persisted message sequences where an assistant
// turn contains tool_calls but one or more matching tool responses are
// missing. This happens when the user reloads the window while tools are
// still executing: the loop pushes a conversation.updated as soon as the
// assistant message is appended (loop.go around the "entry.Append(...
// ToolCalls)" call), but tool results aren't appended until the parallel
// dispatch finishes. Without this repair the OpenAI API rejects the next
// turn with "tool_calls must be followed by tool messages responding to
// each tool_call_id" and the conversation is stuck.
//
// For every orphan tool_call_id, a synthetic tool message is appended
// immediately after the existing tool responses for that assistant turn.
// The synthetic body is short and explicit so the model can decide whether
// to retry the call or proceed without the result.
func healOrphanToolCalls(messages []llm.Message) []llm.Message {
	out := make([]llm.Message, 0, len(messages))
	for i := 0; i < len(messages); i++ {
		m := messages[i]
		out = append(out, m)
		if m.Role != llm.RoleAssistant || len(m.ToolCalls) == 0 {
			continue
		}
		// Consume the consecutive tool responses for this assistant turn.
		responded := make(map[string]bool, len(m.ToolCalls))
		j := i + 1
		for ; j < len(messages); j++ {
			if messages[j].Role != llm.RoleTool {
				break
			}
			responded[messages[j].ToolCallID] = true
			out = append(out, messages[j])
		}
		// Append synthetic responses for any tool_call_ids that weren't
		// satisfied. Keep them after the real responses to preserve order.
		for _, tc := range m.ToolCalls {
			if tc.ID == "" || responded[tc.ID] {
				continue
			}
			out = append(out, llm.Message{
				Role:       llm.RoleTool,
				Content:    "[interrupted: tool execution did not complete before the session was reloaded]",
				ToolCallID: tc.ID,
			})
		}
		i = j - 1
	}
	return out
}

// Lock and Unlock expose the entry's mutex for callers that need an atomic
// multi-step read-modify-write block (currently: scratchpad action handling
// and the summarize-and-replace path). Single-method accessors lock
// internally and should be preferred — only reach for these when a sequence
// of field accesses must observe a consistent state.
func (e *Entry) Lock() {
	e.mu.Lock()
}

func (e *Entry) Unlock() {
	e.mu.Unlock()
}

func (e *Entry) Append(messages ...llm.Message) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.Messages = append(e.Messages, messages...)
}

func (e *Entry) Snapshot() Snapshot {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.snapshotLocked()
}

// snapshotLocked is the lock-free body of Snapshot; callers must already
// hold e.mu. Used by code paths that need to atomically read state and then
// mutate without dropping the lock.
func (e *Entry) snapshotLocked() Snapshot {
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
	e.mu.Lock()
	defer e.mu.Unlock()
	e.LastInputTokens = usage.InputTokens
	e.LastOutputTokens = usage.OutputTokens
	e.CumulativeInput += usage.InputTokens
	e.CumulativeOutput += usage.OutputTokens
	e.CumulativeCacheRead += usage.CacheReadTokens
	e.CumulativeCacheWrite += usage.CacheCreationTokens
}

// SetRulesHash records the hash of the rules bundle captured at task start.
// Frozen for the task lifetime; safe to read via RulesHashValue or by holding
// the lock externally.
func (e *Entry) SetRulesHash(hash string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.RulesHash = hash
}

// RulesHashValue returns the currently-captured rules-bundle hash.
func (e *Entry) RulesHashValue() string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.RulesHash
}

// MessagesCopy returns a defensive copy of the message log so callers can
// pass it to the LLM without holding the lock for the duration of the call.
func (e *Entry) MessagesCopy() []llm.Message {
	e.mu.Lock()
	defer e.mu.Unlock()
	return cloneMessages(e.Messages)
}

// LoadedSkillsCopy returns a defensive copy of the per-conversation
// loaded-skill ids.
func (e *Entry) LoadedSkillsCopy() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.LoadedSkills) == 0 {
		return nil
	}
	out := make([]string, len(e.LoadedSkills))
	copy(out, e.LoadedSkills)
	return out
}

// UsageTotals is the locked view of cumulative + last-turn token counters
// the loop consults to enforce token budgets between turns.
type UsageTotals struct {
	CumulativeInput      int64
	CumulativeOutput     int64
	CumulativeCacheRead  int64
	CumulativeCacheWrite int64
	LastInputTokens      int64
	LastOutputTokens     int64
	MessageCount         int
}

// Usage returns a consistent snapshot of the entry's token counters.
func (e *Entry) Usage() UsageTotals {
	e.mu.Lock()
	defer e.mu.Unlock()
	return UsageTotals{
		CumulativeInput:      e.CumulativeInput,
		CumulativeOutput:     e.CumulativeOutput,
		CumulativeCacheRead:  e.CumulativeCacheRead,
		CumulativeCacheWrite: e.CumulativeCacheWrite,
		LastInputTokens:      e.LastInputTokens,
		LastOutputTokens:     e.LastOutputTokens,
		MessageCount:         len(e.Messages),
	}
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
