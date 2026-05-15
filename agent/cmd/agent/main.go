package main

import (
	"context"
	"encoding/json"
	"log"
	"os"

	"github.com/your-org/loom/internal/llm"
	"github.com/your-org/loom/internal/loop"
	"github.com/your-org/loom/internal/rpc"
)

func main() {
	log.SetOutput(os.Stderr)
	log.SetFlags(0)

	provider, err := llm.NewFromEnv()
	if err != nil {
		log.Fatalf("llm init: %v", err)
	}

	conn := rpc.New(os.Stdin, os.Stdout)

	conn.Handle("task.start", func(params json.RawMessage) (any, error) {
		var p loop.StartParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		d := &loop.Driver{
			Conn:          conn,
			WorkspaceRoot: p.WorkspaceRoot,
			LLM:           provider,
		}
		go func() {
			if err := d.Run(context.Background(), p); err != nil {
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
		// TODO: track tasks and cancel their context
		return nil, nil
	})

	if err := conn.Serve(); err != nil {
		log.Fatalf("rpc serve: %v", err)
	}
}
