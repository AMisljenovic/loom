package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"sync"

	"github.com/your-org/loom/internal/conversation"
	"github.com/your-org/loom/internal/embed"
	"github.com/your-org/loom/internal/index"
	"github.com/your-org/loom/internal/llm"
	"github.com/your-org/loom/internal/loop"
	"github.com/your-org/loom/internal/mcp"
	"github.com/your-org/loom/internal/rpc"
	"github.com/your-org/loom/internal/telemetry"
)

type taskCancelParams struct {
	TaskID string `json:"taskId"`
}

type conversationIDParams struct {
	ConversationID string `json:"conversationId"`
}

type hydrateParams struct {
	ConversationID   string        `json:"conversationId"`
	Messages         []llm.Message `json:"messages"`
	CumulativeInput  int64         `json:"cumulativeInput"`
	CumulativeOutput int64         `json:"cumulativeOutput"`
	LastInputTokens  int64         `json:"lastInputTokens"`
	LastOutputTokens int64         `json:"lastOutputTokens"`
}

type configUpdateParams struct {
	Provider        string `json:"provider"`
	Model           string `json:"model"`
	APIKey          string `json:"apiKey"`
	BaseURL         string `json:"baseUrl"`
	ReasoningEffort string `json:"reasoningEffort"`
}

type providerHolder struct {
	mu       sync.RWMutex
	provider llm.Provider
}

func (h *providerHolder) Get() llm.Provider {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.provider
}

func (h *providerHolder) Set(provider llm.Provider) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.provider = provider
}

func main() {
	log.SetOutput(os.Stderr)
	log.SetFlags(0)

	provider, err := llm.NewFromEnv()
	if err != nil {
		log.Fatalf("llm init: %v", err)
	}

	conn := rpc.New(os.Stdin, os.Stdout)
	conversations := conversation.NewStore()
	providers := &providerHolder{provider: provider}
	mcpManager := mcp.NewManager(func(status mcp.ServerStatus) {
		_ = conn.Notify("mcp.serverStatus", status)
	})
	defer mcpManager.Close()
	telemetryCtx, cancelTelemetry := context.WithCancel(context.Background())
	defer cancelTelemetry()
	telemetryClient := telemetry.NewFromEnv(telemetryCtx)

	embedder, embedErr := embed.NewFromEnv()
	if embedErr != nil {
		log.Printf("embeddings disabled: %v", embedErr)
	}

	indexCtx, cancelIndex := context.WithCancel(context.Background())
	defer cancelIndex()
	var (
		indexerMu sync.Mutex
		indexer   *index.Indexer
		vectors   *index.VectorStore
	)
	ensureIndexer := func(workspaceRoot string) *index.Indexer {
		indexerMu.Lock()
		defer indexerMu.Unlock()
		if indexer != nil || workspaceRoot == "" {
			return indexer
		}
		indexer = index.New(workspaceRoot, func(s index.Status) {
			_ = conn.Notify("index.status", s)
		})
		if embedder != nil {
			vs, err := index.OpenVectorStore(workspaceRoot, embedder.Dim())
			if err != nil {
				log.Printf("vector store: %v", err)
			} else {
				vectors = vs
				indexer.WithEmbeddings(embedder, vs)
			}
		}
		go indexer.Start(indexCtx)
		return indexer
	}
	_ = vectors // closed implicitly when process exits
	var taskMu sync.Mutex
	taskCancels := make(map[string]context.CancelFunc)

	conn.Handle("task.start", func(params json.RawMessage) (any, error) {
		var p loop.StartParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		ctx, cancel := context.WithCancel(context.Background())
		taskMu.Lock()
		taskCancels[p.TaskID] = cancel
		taskMu.Unlock()
		d := &loop.Driver{
			Conn:          conn,
			WorkspaceRoot: p.WorkspaceRoot,
			LLM:           providers.Get(),
			Conversations: conversations,
			MCP:           mcpManager,
			Telemetry:     telemetryClient,
			Index:         ensureIndexer(p.WorkspaceRoot),
			Embedder:      embedder,
		}
		go func() {
			defer func() {
				taskMu.Lock()
				delete(taskCancels, p.TaskID)
				taskMu.Unlock()
			}()
			if err := d.Run(ctx, p); err != nil {
				telemetryClient.Emit("error", map[string]any{
					"where": "loop.Run",
					"kind":  "task_error",
				})
				conn.Notify("task.done", map[string]any{
					"taskId": p.TaskID,
					"reason": "error",
				})
				log.Printf("task error: %v", err)
			}
		}()
		return map[string]any{"accepted": true}, nil
	})

	conn.Handle("task.cancel", func(params json.RawMessage) (any, error) {
		var p taskCancelParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		taskMu.Lock()
		cancel := taskCancels[p.TaskID]
		taskMu.Unlock()
		if cancel != nil {
			cancel()
			return map[string]any{"cancelled": true}, nil
		}
		return map[string]any{"cancelled": false}, nil
	})

	conn.Handle("conversation.reset", func(params json.RawMessage) (any, error) {
		var p conversationIDParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		conversations.Reset(p.ConversationID)
		return map[string]any{"ok": true}, nil
	})

	conn.Handle("conversation.hydrate", func(params json.RawMessage) (any, error) {
		var p hydrateParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		conversations.Hydrate(p.ConversationID, conversation.Snapshot{
			Messages:         p.Messages,
			CumulativeInput:  p.CumulativeInput,
			CumulativeOutput: p.CumulativeOutput,
			LastInputTokens:  p.LastInputTokens,
			LastOutputTokens: p.LastOutputTokens,
		})
		return map[string]any{"ok": true}, nil
	})

	conn.Handle("config.update", func(params json.RawMessage) (any, error) {
		var p configUpdateParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		next, err := llm.New(llm.Config{
			Provider: p.Provider,
			OpenAI: llm.OpenAIConfig{
				APIKey:          p.APIKey,
				BaseURL:         p.BaseURL,
				Model:           p.Model,
				ReasoningEffort: p.ReasoningEffort,
			},
			Anthropic: llm.AnthropicConfig{
				APIKey: p.APIKey,
				Model:  p.Model,
			},
		})
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}, nil
		}
		providers.Set(next)
		return map[string]any{"ok": true}, nil
	})

	conn.Handle("index.invalidate", func(params json.RawMessage) (any, error) {
		var p struct {
			Paths []string `json:"paths"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		indexerMu.Lock()
		idx := indexer
		indexerMu.Unlock()
		if idx != nil && len(p.Paths) > 0 {
			idx.Invalidate(p.Paths)
		}
		return map[string]any{"ok": true}, nil
	})

	conn.Handle("mcp.configure", func(params json.RawMessage) (any, error) {
		cfg, err := mcp.ParseConfig(params)
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}, nil
		}
		if err := mcpManager.Configure(context.Background(), cfg); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}, nil
		}
		return map[string]any{"ok": true}, nil
	})

	if err := conn.Serve(); err != nil {
		log.Fatalf("rpc serve: %v", err)
	}
}
