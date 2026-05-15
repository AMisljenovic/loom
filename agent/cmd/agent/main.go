package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"sync"

	"github.com/your-org/loom/internal/conversation"
	"github.com/your-org/loom/internal/llm"
	"github.com/your-org/loom/internal/loop"
	"github.com/your-org/loom/internal/rpc"
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

func main() {
	log.SetOutput(os.Stderr)
	log.SetFlags(0)

	provider, err := llm.NewFromEnv()
	if err != nil {
		log.Fatalf("llm init: %v", err)
	}

	conn := rpc.New(os.Stdin, os.Stdout)
	conversations := conversation.NewStore()
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
			LLM:           provider,
			Conversations: conversations,
		}
		go func() {
			defer func() {
				taskMu.Lock()
				delete(taskCancels, p.TaskID)
				taskMu.Unlock()
			}()
			if err := d.Run(ctx, p); err != nil {
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

	if err := conn.Serve(); err != nil {
		log.Fatalf("rpc serve: %v", err)
	}
}
