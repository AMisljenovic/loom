package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

type AnthropicConfig struct {
	APIKey    string
	Model     string
	MaxTokens int64 // 0 -> default 8192
}

type anthropicProvider struct {
	client    anthropic.Client
	model     string
	maxTokens int64
}

func newAnthropic(cfg AnthropicConfig) (Provider, error) {
	if cfg.APIKey == "" {
		return nil, errors.New("ANTHROPIC_API_KEY is required when MY_AGENT_PROVIDER=anthropic")
	}
	if cfg.Model == "" {
		return nil, errors.New("MY_AGENT_MODEL is required")
	}
	maxTokens := cfg.MaxTokens
	if maxTokens == 0 {
		maxTokens = 8192
	}
	return &anthropicProvider{
		client:    anthropic.NewClient(option.WithAPIKey(cfg.APIKey)),
		model:     cfg.Model,
		maxTokens: maxTokens,
	}, nil
}

func (p *anthropicProvider) Stream(
	ctx context.Context,
	systemPrompt string,
	messages []Message,
	tools []ToolDef,
	h StreamHandler,
) (StreamResult, error) {
	antMsgs, err := toAnthropicMessages(messages)
	if err != nil {
		return StreamResult{}, err
	}

	antTools, err := toAnthropicTools(tools)
	if err != nil {
		return StreamResult{}, err
	}

	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(p.model),
		MaxTokens: p.maxTokens,
		Messages:  antMsgs,
	}
	if systemPrompt != "" {
		params.System = []anthropic.TextBlockParam{{Text: systemPrompt}}
	}
	if len(antTools) > 0 {
		params.Tools = antTools
	}

	stream := p.client.Messages.NewStreaming(ctx, params)
	acc := anthropic.Message{}

	for stream.Next() {
		event := stream.Current()
		if err := acc.Accumulate(event); err != nil {
			return StreamResult{}, fmt.Errorf("accumulate stream event: %w", err)
		}

		switch ev := event.AsAny().(type) {
		case anthropic.ContentBlockDeltaEvent:
			if td := ev.Delta.AsTextDelta(); td.Text != "" {
				h.OnTextDelta(td.Text)
			}
		case anthropic.ContentBlockStopEvent:
			idx := int(ev.Index)
			if idx < 0 || idx >= len(acc.Content) {
				continue
			}
			block := acc.Content[idx]
			if block.Type != "tool_use" {
				continue
			}
			input := block.Input
			if len(input) == 0 {
				input = json.RawMessage("{}")
			}
			h.OnToolUse(ToolCall{
				ID:    block.ID,
				Name:  block.Name,
				Input: input,
			})
		}
	}
	if err := stream.Err(); err != nil {
		return StreamResult{}, err
	}

	result := StreamResult{
		StopReason: "end_turn",
		Usage: TokenUsage{
			InputTokens:  acc.Usage.InputTokens,
			OutputTokens: acc.Usage.OutputTokens,
		},
	}
	if acc.StopReason == anthropic.StopReasonToolUse {
		result.StopReason = "tool_calls"
	}
	return result, nil
}

func (p *anthropicProvider) Complete(ctx context.Context, systemPrompt string, messages []Message) (string, TokenUsage, error) {
	antMsgs, err := toAnthropicMessages(messages)
	if err != nil {
		return "", TokenUsage{}, err
	}
	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(p.model),
		MaxTokens: p.maxTokens,
		Messages:  antMsgs,
	}
	if systemPrompt != "" {
		params.System = []anthropic.TextBlockParam{{Text: systemPrompt}}
	}
	msg, err := p.client.Messages.New(ctx, params)
	if err != nil {
		return "", TokenUsage{}, err
	}
	var b strings.Builder
	for _, block := range msg.Content {
		if block.Type == "text" {
			b.WriteString(block.Text)
		}
	}
	return b.String(), TokenUsage{
		InputTokens:  msg.Usage.InputTokens,
		OutputTokens: msg.Usage.OutputTokens,
	}, nil
}

func (p *anthropicProvider) Model() string {
	return p.model
}

func (p *anthropicProvider) MaxContextTokens() int64 {
	return ModelContextLimit(p.model)
}

func toAnthropicMessages(messages []Message) ([]anthropic.MessageParam, error) {
	out := make([]anthropic.MessageParam, 0, len(messages))
	for _, m := range messages {
		switch m.Role {
		case RoleUser:
			out = append(out, anthropic.NewUserMessage(anthropic.NewTextBlock(m.Content)))
		case RoleAssistant:
			blocks := make([]anthropic.ContentBlockParamUnion, 0, len(m.ToolCalls)+1)
			if m.Content != "" {
				blocks = append(blocks, anthropic.NewTextBlock(m.Content))
			}
			for _, tc := range m.ToolCalls {
				var input any
				if len(tc.Input) == 0 {
					input = map[string]any{}
				} else if err := json.Unmarshal(tc.Input, &input); err != nil {
					return nil, fmt.Errorf("unmarshal tool input for %s: %w", tc.Name, err)
				}
				blocks = append(blocks, anthropic.NewToolUseBlock(tc.ID, input, tc.Name))
			}
			if len(blocks) == 0 {
				// Anthropic rejects empty content; skip degenerate turns.
				continue
			}
			out = append(out, anthropic.NewAssistantMessage(blocks...))
		case RoleTool:
			out = append(out, anthropic.NewUserMessage(
				anthropic.NewToolResultBlock(m.ToolCallID, m.Content, false),
			))
		}
	}
	return out, nil
}

func toAnthropicTools(tools []ToolDef) ([]anthropic.ToolUnionParam, error) {
	if len(tools) == 0 {
		return nil, nil
	}
	out := make([]anthropic.ToolUnionParam, len(tools))
	for i, t := range tools {
		schema := anthropic.ToolInputSchemaParam{}
		if props, ok := t.InputSchema["properties"]; ok {
			schema.Properties = props
		}
		if req, ok := t.InputSchema["required"].([]string); ok {
			schema.Required = req
		} else if reqAny, ok := t.InputSchema["required"].([]any); ok {
			reqs := make([]string, 0, len(reqAny))
			for _, r := range reqAny {
				if s, ok := r.(string); ok {
					reqs = append(reqs, s)
				}
			}
			schema.Required = reqs
		}
		tool := anthropic.ToolParam{
			Name:        t.Name,
			InputSchema: schema,
		}
		if t.Description != "" {
			tool.Description = anthropic.String(t.Description)
		}
		out[i] = anthropic.ToolUnionParam{OfTool: &tool}
	}
	return out, nil
}
