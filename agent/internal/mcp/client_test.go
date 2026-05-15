package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

func TestClientDispatchesResponsesByID(t *testing.T) {
	serverToClientR, serverToClientW := io.Pipe()
	clientToServerR, clientToServerW := io.Pipe()
	client := NewClient(serverToClientR, clientToServerW, clientToServerW.Close)
	client.Start()

	go func() {
		line, err := bufio.NewReader(clientToServerR).ReadString('\n')
		if err != nil {
			t.Errorf("read request: %v", err)
			return
		}
		var request rpcMessage
		if err := json.Unmarshal([]byte(strings.TrimSpace(line)), &request); err != nil {
			t.Errorf("decode request: %v", err)
			return
		}
		if request.ID == nil {
			t.Errorf("request missing ID")
			return
		}
		_, _ = serverToClientW.Write([]byte(`{"jsonrpc":"2.0","id":` + string(*request.ID) + `,"result":{"ok":true}}` + "\n"))
	}()

	var result struct {
		OK bool `json:"ok"`
	}
	if err := client.Request(context.Background(), "test", map[string]any{}, &result); err != nil {
		t.Fatal(err)
	}
	if !result.OK {
		t.Fatal("response was not decoded")
	}
}
