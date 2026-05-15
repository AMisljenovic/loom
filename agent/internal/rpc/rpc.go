package rpc

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
)

type Message struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      *json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}

type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *RPCError) Error() string { return e.Message }

type Handler func(params json.RawMessage) (any, error)

type Conn struct {
	in  *bufio.Reader
	out io.Writer

	writeMu  sync.Mutex
	nextID   atomic.Int64
	handlers map[string]Handler
	hMu      sync.RWMutex

	pendingMu sync.Mutex
	pending   map[int64]chan *Message
}

func New(in io.Reader, out io.Writer) *Conn {
	return &Conn{
		in:       bufio.NewReader(in),
		out:      out,
		handlers: make(map[string]Handler),
		pending:  make(map[int64]chan *Message),
	}
}

func (c *Conn) Handle(method string, h Handler) {
	c.hMu.Lock()
	defer c.hMu.Unlock()
	c.handlers[method] = h
}

func (c *Conn) Notify(method string, params any) error {
	return c.write(&Message{JSONRPC: "2.0", Method: method, Params: mustMarshal(params)})
}

func (c *Conn) Request(method string, params any, out any) error {
	id := c.nextID.Add(1)
	ch := make(chan *Message, 1)
	c.pendingMu.Lock()
	c.pending[id] = ch
	c.pendingMu.Unlock()

	idRaw := json.RawMessage(strconv.FormatInt(id, 10))
	if err := c.write(&Message{
		JSONRPC: "2.0",
		ID:      &idRaw,
		Method:  method,
		Params:  mustMarshal(params),
	}); err != nil {
		return err
	}
	resp := <-ch
	if resp.Error != nil {
		return resp.Error
	}
	if out != nil && len(resp.Result) > 0 {
		return json.Unmarshal(resp.Result, out)
	}
	return nil
}

func (c *Conn) Serve() error {
	for {
		msg, err := c.readMessage()
		if err != nil {
			return err
		}
		go c.dispatch(msg)
	}
}

func (c *Conn) dispatch(m *Message) {
	if m.Method != "" {
		c.hMu.RLock()
		h, ok := c.handlers[m.Method]
		c.hMu.RUnlock()
		if m.ID != nil {
			// request
			var resp Message
			resp.JSONRPC = "2.0"
			resp.ID = m.ID
			if !ok {
				resp.Error = &RPCError{Code: -32601, Message: "method not found"}
			} else {
				result, err := h(m.Params)
				if err != nil {
					resp.Error = &RPCError{Code: -32000, Message: err.Error()}
				} else {
					resp.Result = mustMarshal(result)
				}
			}
			_ = c.write(&resp)
		} else if ok {
			// notification
			_, _ = h(m.Params)
		}
		return
	}
	// response
	if m.ID == nil {
		return
	}
	var id int64
	if err := json.Unmarshal(*m.ID, &id); err != nil {
		return
	}
	c.pendingMu.Lock()
	ch, ok := c.pending[id]
	delete(c.pending, id)
	c.pendingMu.Unlock()
	if ok {
		ch <- m
	}
}

func (c *Conn) write(m *Message) error {
	body, err := json.Marshal(m)
	if err != nil {
		return err
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if _, err := fmt.Fprintf(c.out, "Content-Length: %d\r\n\r\n", len(body)); err != nil {
		return err
	}
	_, err = c.out.Write(body)
	return err
}

func (c *Conn) readMessage() (*Message, error) {
	var contentLength int
	for {
		line, err := c.in.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		if strings.HasPrefix(strings.ToLower(line), "content-length:") {
			v := strings.TrimSpace(line[len("Content-Length:"):])
			contentLength, err = strconv.Atoi(v)
			if err != nil {
				return nil, err
			}
		}
	}
	if contentLength == 0 {
		return nil, fmt.Errorf("missing Content-Length")
	}
	buf := make([]byte, contentLength)
	if _, err := io.ReadFull(c.in, buf); err != nil {
		return nil, err
	}
	var m Message
	if err := json.Unmarshal(buf, &m); err != nil {
		return nil, err
	}
	return &m, nil
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
