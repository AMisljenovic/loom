package mcp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"sync"
)

type stdioTransport struct {
	r       *bufio.Reader
	w       io.Writer
	writeMu sync.Mutex
}

func newStdioTransport(r io.Reader, w io.Writer) *stdioTransport {
	return &stdioTransport{
		r: bufio.NewReader(r),
		w: w,
	}
}

func (t *stdioTransport) Write(v any) error {
	body, err := json.Marshal(v)
	if err != nil {
		return err
	}
	t.writeMu.Lock()
	defer t.writeMu.Unlock()
	if _, err := t.w.Write(body); err != nil {
		return err
	}
	_, err = t.w.Write([]byte("\n"))
	return err
}

func (t *stdioTransport) Read() (json.RawMessage, error) {
	line, err := t.r.ReadBytes('\n')
	if err != nil {
		return nil, err
	}
	line = bytes.TrimSpace(line)
	if len(line) == 0 {
		return nil, fmt.Errorf("empty MCP message")
	}
	if !json.Valid(line) {
		return nil, fmt.Errorf("invalid MCP JSON: %s", string(line))
	}
	return append(json.RawMessage(nil), line...), nil
}
