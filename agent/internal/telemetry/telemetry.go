// Package telemetry provides opt-in anonymous usage reporting. It is
// constructed only when LOOM_TELEMETRY_ENABLED=1; otherwise callers receive
// a no-op client and emit calls become free.
//
// Anonymity: callers pass a pre-hashed machine ID (SHA-256 of
// vscode.env.machineId), never a raw identifier. Workspace paths, prompts,
// and file contents must never be passed in.
package telemetry

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

const (
	ringCap       = 1000
	flushInterval = 60 * time.Second
)

// Event is one telemetry record. Keep fields primitive and bounded.
type Event struct {
	Type      string         `json:"type"`
	Timestamp int64          `json:"ts"`
	Machine   string         `json:"machine,omitempty"`
	Fields    map[string]any `json:"fields,omitempty"`
}

// Client buffers events and flushes them to an HTTP endpoint.
type Client struct {
	endpoint string
	machine  string
	http     *http.Client

	mu     sync.Mutex
	buf    []Event
	closed bool
}

// NewFromEnv reads LOOM_TELEMETRY_ENABLED and LOOM_TELEMETRY_ENDPOINT. When
// telemetry is disabled it returns nil; callers must nil-check.
func NewFromEnv(ctx context.Context) *Client {
	if os.Getenv("LOOM_TELEMETRY_ENABLED") != "1" {
		return nil
	}
	c := &Client{
		endpoint: os.Getenv("LOOM_TELEMETRY_ENDPOINT"),
		machine:  os.Getenv("LOOM_TELEMETRY_MACHINE_ID"),
		http:     &http.Client{Timeout: 10 * time.Second},
		buf:      make([]Event, 0, ringCap),
	}
	go c.run(ctx)
	return c
}

// Emit records an event. Safe to call on a nil client (becomes a no-op).
func (c *Client) Emit(eventType string, fields map[string]any) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	if len(c.buf) >= ringCap {
		// drop oldest
		copy(c.buf, c.buf[1:])
		c.buf = c.buf[:ringCap-1]
	}
	c.buf = append(c.buf, Event{
		Type:      eventType,
		Timestamp: time.Now().UnixMilli(),
		Machine:   c.machine,
		Fields:    fields,
	})
}

func (c *Client) run(ctx context.Context) {
	t := time.NewTicker(flushInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			c.flush()
			c.mu.Lock()
			c.closed = true
			c.mu.Unlock()
			return
		case <-t.C:
			c.flush()
		}
	}
}

func (c *Client) flush() {
	c.mu.Lock()
	if len(c.buf) == 0 {
		c.mu.Unlock()
		return
	}
	batch := c.buf
	c.buf = make([]Event, 0, ringCap)
	c.mu.Unlock()

	if c.endpoint == "" {
		// Stub mode: drop after counting. Useful for end-to-end testing of the
		// emit path without a real backend.
		log.Printf("telemetry: dropped %d events (no endpoint configured)", len(batch))
		return
	}
	body, err := json.Marshal(batch)
	if err != nil {
		log.Printf("telemetry: marshal: %v", err)
		return
	}
	req, err := http.NewRequest(http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		log.Printf("telemetry: request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		log.Printf("telemetry: post: %v", err)
		return
	}
	resp.Body.Close()
	log.Printf("telemetry: flushed %d events (%s)", len(batch), resp.Status)
}
