package rpc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestRequestContextCancelRemovesPending(t *testing.T) {
	var out bytes.Buffer
	conn := New(bytes.NewReader(nil), &out)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	var result map[string]any
	err := conn.RequestContext(ctx, "tool.call", map[string]any{"ok": true}, &result)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}

	conn.pendingMu.Lock()
	defer conn.pendingMu.Unlock()
	if len(conn.pending) != 0 {
		t.Fatalf("expected no pending requests, got %d", len(conn.pending))
	}
}

func TestLateResponseAfterCancelIsIgnored(t *testing.T) {
	var out bytes.Buffer
	conn := New(bytes.NewReader(nil), &out)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_ = conn.RequestContext(ctx, "tool.call", nil, nil)
	id := json.RawMessage("1")
	conn.dispatch(&Message{
		JSONRPC: "2.0",
		ID:      &id,
		Result:  json.RawMessage(`{"ok":true}`),
	})

	conn.pendingMu.Lock()
	defer conn.pendingMu.Unlock()
	if len(conn.pending) != 0 {
		t.Fatalf("expected late response to remain ignored, got %d pending", len(conn.pending))
	}
}
