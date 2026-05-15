package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

const protocolVersion = "2025-11-25"

type rpcMessage struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      *json.RawMessage `json:"id,omitempty"`
	Method  string           `json:"method,omitempty"`
	Params  json.RawMessage  `json:"params,omitempty"`
	Result  json.RawMessage  `json:"result,omitempty"`
	Error   *rpcError        `json:"error,omitempty"`
}

type rpcError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *rpcError) Error() string {
	return e.Message
}

type Client struct {
	transport *stdioTransport
	closeFn   func() error

	nextID atomic.Int64

	pendingMu sync.Mutex
	pending   map[string]chan *rpcMessage

	notifyMu sync.RWMutex
	notify   map[string]func(json.RawMessage)
}

func NewClient(r io.Reader, w io.Writer, closeFn func() error) *Client {
	return &Client{
		transport: newStdioTransport(r, w),
		closeFn:   closeFn,
		pending:   map[string]chan *rpcMessage{},
		notify:    map[string]func(json.RawMessage){},
	}
}

func (c *Client) Start() {
	go c.readLoop()
}

func (c *Client) Close() error {
	if c.closeFn != nil {
		return c.closeFn()
	}
	return nil
}

func (c *Client) OnNotification(method string, h func(json.RawMessage)) {
	c.notifyMu.Lock()
	defer c.notifyMu.Unlock()
	c.notify[method] = h
}

func (c *Client) Initialize(ctx context.Context) error {
	var result struct {
		ProtocolVersion string         `json:"protocolVersion"`
		Capabilities    map[string]any `json:"capabilities"`
	}
	if err := c.Request(ctx, "initialize", map[string]any{
		"protocolVersion": protocolVersion,
		"capabilities":    map[string]any{},
		"clientInfo": map[string]any{
			"name":    "loom",
			"title":   "Loom",
			"version": "0.7.0",
		},
	}, &result); err != nil {
		return err
	}
	if result.ProtocolVersion == "" {
		return fmt.Errorf("MCP server did not return protocolVersion")
	}
	return c.Notify("notifications/initialized", nil)
}

func (c *Client) ListTools(ctx context.Context) ([]RemoteTool, error) {
	var all []RemoteTool
	cursor := ""
	for {
		params := map[string]any{}
		if cursor != "" {
			params["cursor"] = cursor
		}
		var result struct {
			Tools      []RemoteTool `json:"tools"`
			NextCursor string       `json:"nextCursor"`
		}
		if err := c.Request(ctx, "tools/list", params, &result); err != nil {
			return nil, err
		}
		all = append(all, result.Tools...)
		if result.NextCursor == "" {
			return all, nil
		}
		cursor = result.NextCursor
	}
}

func (c *Client) CallTool(ctx context.Context, name string, args json.RawMessage) (CallToolResult, error) {
	var arguments any = map[string]any{}
	if len(args) > 0 {
		if err := json.Unmarshal(args, &arguments); err != nil {
			return CallToolResult{}, err
		}
	}
	var result CallToolResult
	err := c.Request(ctx, "tools/call", map[string]any{
		"name":      name,
		"arguments": arguments,
	}, &result)
	return result, err
}

func (c *Client) Request(ctx context.Context, method string, params any, out any) error {
	id := c.nextID.Add(1)
	idRaw := json.RawMessage(strconv.FormatInt(id, 10))
	key := string(idRaw)
	ch := make(chan *rpcMessage, 1)

	c.pendingMu.Lock()
	c.pending[key] = ch
	c.pendingMu.Unlock()
	defer func() {
		c.pendingMu.Lock()
		delete(c.pending, key)
		c.pendingMu.Unlock()
	}()

	msg := rpcMessage{
		JSONRPC: "2.0",
		ID:      &idRaw,
		Method:  method,
		Params:  mustMarshal(params),
	}
	if err := c.transport.Write(msg); err != nil {
		return err
	}

	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
	}

	select {
	case <-ctx.Done():
		return ctx.Err()
	case resp := <-ch:
		if resp.Error != nil {
			return resp.Error
		}
		if out != nil && len(resp.Result) > 0 {
			return json.Unmarshal(resp.Result, out)
		}
		return nil
	}
}

func (c *Client) Notify(method string, params any) error {
	return c.transport.Write(rpcMessage{
		JSONRPC: "2.0",
		Method:  method,
		Params:  mustMarshal(params),
	})
}

func (c *Client) readLoop() {
	for {
		raw, err := c.transport.Read()
		if err != nil {
			c.failPending(err)
			return
		}
		var msg rpcMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		c.dispatch(msg)
	}
}

func (c *Client) dispatch(msg rpcMessage) {
	if msg.ID != nil && msg.Method == "" {
		key := string(*msg.ID)
		c.pendingMu.Lock()
		ch, ok := c.pending[key]
		c.pendingMu.Unlock()
		if ok {
			ch <- &msg
		}
		return
	}
	if msg.Method == "" {
		return
	}
	if msg.ID != nil {
		_ = c.transport.Write(rpcMessage{
			JSONRPC: "2.0",
			ID:      msg.ID,
			Error:   &rpcError{Code: -32601, Message: "method not found"},
		})
		return
	}
	c.notifyMu.RLock()
	h := c.notify[msg.Method]
	c.notifyMu.RUnlock()
	if h != nil {
		h(msg.Params)
	}
}

func (c *Client) failPending(err error) {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	for key, ch := range c.pending {
		delete(c.pending, key)
		ch <- &rpcMessage{Error: &rpcError{Code: -32000, Message: err.Error()}}
	}
}

func mustMarshal(v any) json.RawMessage {
	if v == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage("null")
	}
	return b
}
