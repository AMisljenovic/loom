package mcp

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

func TestStdioTransportWriteUsesNewlineDelimitedJSON(t *testing.T) {
	var out bytes.Buffer
	tr := newStdioTransport(strings.NewReader(""), &out)
	if err := tr.Write(map[string]any{"jsonrpc": "2.0", "method": "ping"}); err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(out.String(), "\n") {
		t.Fatalf("message is not newline delimited: %q", out.String())
	}
	if strings.Contains(out.String(), "Content-Length") {
		t.Fatalf("MCP transport must not use LSP framing: %q", out.String())
	}
	var decoded map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(out.Bytes()), &decoded); err != nil {
		t.Fatal(err)
	}
}

func TestStdioTransportReadHandlesPartialReads(t *testing.T) {
	reader := &chunkReader{chunks: []string{`{"jsonrpc":"2.0"`, `,"id":1}`, "\n"}}
	tr := newStdioTransport(reader, &bytes.Buffer{})
	raw, err := tr.Read()
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"jsonrpc":"2.0","id":1}` {
		t.Fatalf("raw = %s", raw)
	}
}

func TestStdioTransportReadRejectsInvalidJSON(t *testing.T) {
	tr := newStdioTransport(strings.NewReader("{nope}\n"), &bytes.Buffer{})
	if _, err := tr.Read(); err == nil {
		t.Fatal("expected invalid JSON error")
	}
}

type chunkReader struct {
	chunks []string
}

func (r *chunkReader) Read(p []byte) (int, error) {
	if len(r.chunks) == 0 {
		return 0, io.EOF
	}
	chunk := r.chunks[0]
	r.chunks = r.chunks[1:]
	return copy(p, chunk), nil
}
