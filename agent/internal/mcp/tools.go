package mcp

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/your-org/loom/internal/tools"
)

type RemoteTool struct {
	Name        string         `json:"name"`
	Title       string         `json:"title,omitempty"`
	Description string         `json:"description,omitempty"`
	InputSchema map[string]any `json:"inputSchema"`
}

type ContentBlock struct {
	Type     string          `json:"type"`
	Text     string          `json:"text,omitempty"`
	Data     string          `json:"data,omitempty"`
	MIMEType string          `json:"mimeType,omitempty"`
	URI      string          `json:"uri,omitempty"`
	Name     string          `json:"name,omitempty"`
	Resource json.RawMessage `json:"resource,omitempty"`
}

type CallToolResult struct {
	Content           []ContentBlock  `json:"content"`
	StructuredContent json.RawMessage `json:"structuredContent,omitempty"`
	IsError           bool            `json:"isError,omitempty"`
	Extra             map[string]any  `json:"-"`
}

func PrefixedToolName(serverName, toolName string) string {
	return "mcp__" + serverName + "__" + toolName
}

func ToTools(serverName string, remote []RemoteTool, call func(name string, input json.RawMessage) (string, error)) []tools.Tool {
	out := make([]tools.Tool, 0, len(remote))
	for _, rt := range remote {
		rt := rt
		if rt.Name == "" {
			continue
		}
		schema := rt.InputSchema
		if schema == nil {
			schema = map[string]any{"type": "object"}
		}
		description := rt.Description
		if description == "" {
			description = rt.Title
		}
		if description == "" {
			description = "MCP tool from server " + serverName + "."
		}
		out = append(out, tools.Tool{
			Name:             PrefixedToolName(serverName, rt.Name),
			Description:      description,
			InputSchema:      schema,
			RequiresApproval: true,
			LocalExec: func(_ string, input json.RawMessage) (string, error) {
				return call(rt.Name, input)
			},
		})
	}
	return out
}

func RenderToolResult(result CallToolResult) (string, error) {
	var parts []string
	for _, item := range result.Content {
		switch item.Type {
		case "text":
			if item.Text != "" {
				parts = append(parts, item.Text)
			}
		case "resource_link":
			label := item.URI
			if item.Name != "" {
				label = item.Name + " <" + item.URI + ">"
			}
			if label != "" {
				parts = append(parts, "[resource_link] "+label)
			}
		case "resource":
			if len(item.Resource) > 0 {
				parts = append(parts, "[resource] "+string(item.Resource))
			}
		case "image", "audio":
			media := item.Type
			if item.MIMEType != "" {
				media += " " + item.MIMEType
			}
			if item.Data != "" {
				media += fmt.Sprintf(" (%d base64 chars)", len(item.Data))
			}
			parts = append(parts, "["+media+"]")
		default:
			b, _ := json.Marshal(item)
			parts = append(parts, string(b))
		}
	}
	if len(result.StructuredContent) > 0 {
		parts = append(parts, "structuredContent:\n"+string(result.StructuredContent))
	}
	text := strings.TrimSpace(strings.Join(parts, "\n\n"))
	if text == "" {
		text = "(empty MCP tool result)"
	}
	if result.IsError {
		return text, fmt.Errorf("%s", text)
	}
	return text, nil
}
