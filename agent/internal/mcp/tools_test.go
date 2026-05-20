package mcp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestRenderToolResult(t *testing.T) {
	result := CallToolResult{
		Content: []ContentBlock{
			{Type: "text", Text: "hello"},
			{Type: "image", MIMEType: "image/png", Data: "abc123"},
		},
		StructuredContent: json.RawMessage(`{"ok":true}`),
	}
	got, err := RenderToolResult(result)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"hello", "[image image/png", "structuredContent", `"ok":true`} {
		if !strings.Contains(got, want) {
			t.Fatalf("expected %q in %q", want, got)
		}
	}
}

func TestRenderToolResultError(t *testing.T) {
	_, err := RenderToolResult(CallToolResult{
		IsError: true,
		Content: []ContentBlock{{Type: "text", Text: "failed"}},
	})
	if err == nil || !strings.Contains(err.Error(), "failed") {
		t.Fatalf("expected tool error, got %v", err)
	}
}

func TestToolPrefixAndAdapter(t *testing.T) {
	converted := ToTools("fs", []RemoteTool{{
		Name:        "read_file",
		Description: "Read",
		InputSchema: map[string]any{"type": "object"},
	}}, func(_ context.Context, name string, input json.RawMessage) (string, error) {
		if name != "read_file" {
			t.Fatalf("name = %q", name)
		}
		return "ok", nil
	})
	if len(converted) != 1 {
		t.Fatalf("len = %d", len(converted))
	}
	if converted[0].Name != "mcp__fs__read_file" {
		t.Fatalf("name = %q", converted[0].Name)
	}
	if !converted[0].RequiresApproval {
		t.Fatal("MCP tools must require approval")
	}
	got, err := converted[0].LocalExec(context.Background(), "", json.RawMessage(`{}`))
	if err != nil || got != "ok" {
		t.Fatalf("LocalExec = %q, %v", got, err)
	}
}
