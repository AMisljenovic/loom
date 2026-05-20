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

func TestDispatchRecoversFromHandlerPanic(t *testing.T) {
	var out bytes.Buffer
	conn := New(bytes.NewReader(nil), &out)
	conn.Handle("boom", func(_ json.RawMessage) (any, error) {
		panic("kaboom")
	})

	id := json.RawMessage("42")
	conn.dispatch(&Message{
		JSONRPC: "2.0",
		ID:      &id,
		Method:  "boom",
	})

	// Peer must receive a JSON-RPC error response (internal error -32603)
	// with the original request id — not a hung connection.
	frame := out.String()
	if !bytes.Contains([]byte(frame), []byte(`"code":-32603`)) {
		t.Fatalf("expected internal-error response in frame, got %q", frame)
	}
	if !bytes.Contains([]byte(frame), []byte(`"id":42`)) {
		t.Fatalf("expected id=42 in response frame, got %q", frame)
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
