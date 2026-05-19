package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/packages/param"
	"github.com/openai/openai-go/shared"
)

type HeaderPair struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type OpenAIConfig struct {
	APIKey          string
	BaseURL         string // empty -> SDK default (https://api.openai.com/v1)
	Model           string
	ReasoningEffort string // "" | "low" | "medium" | "high"
	// Advanced options. Zero values mean "use provider defaults".
	MaxOutputTokens int64
	ContextWindow   int64
	CustomHeaders   []HeaderPair
}

type openaiProvider struct {
	client          openai.Client
	model           string
	effort          shared.ReasoningEffort
	maxOutputTokens int64
	contextWindow   int64
}

func newOpenAI(cfg OpenAIConfig) (Provider, error) {
	if cfg.APIKey == "" {
		return nil, errors.New("OPENAI_API_KEY is required when MY_AGENT_PROVIDER=openai")
	}
	if cfg.Model == "" {
		return nil, errors.New("OPENAI_MODEL is required")
	}

	opts := openAIRequestOptions(cfg)

	var effort shared.ReasoningEffort
	switch strings.ToLower(strings.TrimSpace(cfg.ReasoningEffort)) {
	case "":
		// none
	case "low":
		effort = shared.ReasoningEffortLow
	case "medium":
		effort = shared.ReasoningEffortMedium
	case "high":
		effort = shared.ReasoningEffortHigh
	default:
		return nil, fmt.Errorf("invalid OPENAI_REASONING_EFFORT %q (expected low|medium|high)", cfg.ReasoningEffort)
	}

	return &openaiProvider{
		client:          openai.NewClient(opts...),
		model:           cfg.Model,
		effort:          effort,
		maxOutputTokens: cfg.MaxOutputTokens,
		contextWindow:   cfg.ContextWindow,
	}, nil
}

func openAIRequestOptions(cfg OpenAIConfig) []option.RequestOption {
	opts := []option.RequestOption{option.WithAPIKey(cfg.APIKey)}
	if cfg.BaseURL != "" {
		opts = append(opts, option.WithBaseURL(cfg.BaseURL))
		if isAzureOpenAIBaseURL(cfg.BaseURL) {
			opts = append(
				opts,
				option.WithHeaderDel("authorization"),
				option.WithHeader("api-key", cfg.APIKey),
			)
		}
	}
	for _, h := range cfg.CustomHeaders {
		name := strings.TrimSpace(h.Name)
		if name == "" {
			continue
		}
		opts = append(opts, option.WithHeader(name, h.Value))
	}
	return opts
}

func isAzureOpenAIBaseURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return strings.HasSuffix(host, ".openai.azure.com") ||
		strings.HasSuffix(host, ".services.ai.azure.com") ||
		strings.HasSuffix(host, ".cognitiveservices.azure.com")
}

func (p *openaiProvider) Family() string {
	m := strings.ToLower(strings.TrimPrefix(p.model, "models/"))
	if strings.HasPrefix(m, "gemini") {
		return "gemini"
	}
	return "openai"
}

func (p *openaiProvider) Stream(
	ctx context.Context,
	system SystemPrompt,
	messages []Message,
	tools []ToolDef,
	h StreamHandler,
) (StreamResult, error) {
	oaiMsgs := make([]openai.ChatCompletionMessageParamUnion, 0, len(messages)+1)
	if systemPrompt := system.String(); systemPrompt != "" {
		oaiMsgs = append(oaiMsgs, openai.SystemMessage(systemPrompt))
	}
	for _, m := range messages {
		switch m.Role {
		case RoleUser:
			oaiMsgs = append(oaiMsgs, openAIUserMessage(m))
		case RoleAssistant:
			if len(m.ToolCalls) == 0 {
				oaiMsgs = append(oaiMsgs, openai.AssistantMessage(m.Content))
				continue
			}
			tcs := make([]openai.ChatCompletionMessageToolCallParam, len(m.ToolCalls))
			for i, tc := range m.ToolCalls {
				args := string(tc.Input)
				if args == "" {
					args = "{}"
				}
				tcs[i] = openai.ChatCompletionMessageToolCallParam{
					ID: tc.ID,
					Function: openai.ChatCompletionMessageToolCallFunctionParam{
						Name:      tc.Name,
						Arguments: args,
					},
				}
			}
			asst := openai.ChatCompletionAssistantMessageParam{ToolCalls: tcs}
			if m.Content != "" {
				asst.Content = openai.ChatCompletionAssistantMessageParamContentUnion{
					OfString: param.NewOpt(m.Content),
				}
			}
			oaiMsgs = append(oaiMsgs, openai.ChatCompletionMessageParamUnion{OfAssistant: &asst})
		case RoleTool:
			oaiMsgs = append(oaiMsgs, openai.ToolMessage(m.Content, m.ToolCallID))
		}
	}

	oaiTools := make([]openai.ChatCompletionToolParam, len(tools))
	for i, t := range tools {
		oaiTools[i] = openai.ChatCompletionToolParam{
			Function: shared.FunctionDefinitionParam{
				Name:        t.Name,
				Description: param.NewOpt(t.Description),
				Parameters:  shared.FunctionParameters(t.InputSchema),
			},
		}
	}

	params := openai.ChatCompletionNewParams{
		Model:         p.model,
		Messages:      oaiMsgs,
		StreamOptions: openai.ChatCompletionStreamOptionsParam{IncludeUsage: openai.Bool(true)},
	}
	if len(oaiTools) > 0 {
		params.Tools = oaiTools
	}
	if p.effort != "" {
		params.ReasoningEffort = p.effort
	}
	if p.maxOutputTokens > 0 {
		params.MaxTokens = openai.Int(p.maxOutputTokens)
	}

	stream := p.client.Chat.Completions.NewStreaming(ctx, params)
	acc := openai.ChatCompletionAccumulator{}
	var finishReason string

	for stream.Next() {
		chunk := stream.Current()
		acc.AddChunk(chunk)

		if len(chunk.Choices) > 0 {
			choice := chunk.Choices[0]
			if choice.Delta.Content != "" {
				h.OnTextDelta(choice.Delta.Content)
			}
			if choice.FinishReason != "" {
				finishReason = string(choice.FinishReason)
			}
		}

		if tc, ok := acc.JustFinishedToolCall(); ok {
			args := tc.Arguments
			if args == "" {
				args = "{}"
			}
			h.OnToolUse(ToolCall{
				ID:    tc.ID,
				Name:  tc.Name,
				Input: json.RawMessage(args),
			})
		}
	}
	if err := stream.Err(); err != nil {
		return StreamResult{}, err
	}

	result := StreamResult{
		StopReason: "end_turn",
		Usage: TokenUsage{
			InputTokens:     acc.Usage.PromptTokens,
			OutputTokens:    acc.Usage.CompletionTokens,
			CacheReadTokens: acc.Usage.PromptTokensDetails.CachedTokens,
		},
	}
	switch finishReason {
	case "tool_calls":
		result.StopReason = "tool_calls"
	}
	return result, nil
}

func (p *openaiProvider) Complete(ctx context.Context, systemPrompt string, messages []Message) (string, TokenUsage, error) {
	oaiMsgs := make([]openai.ChatCompletionMessageParamUnion, 0, len(messages)+1)
	if systemPrompt != "" {
		oaiMsgs = append(oaiMsgs, openai.SystemMessage(systemPrompt))
	}
	for _, m := range messages {
		switch m.Role {
		case RoleUser:
			oaiMsgs = append(oaiMsgs, openAIUserMessage(m))
		case RoleAssistant:
			oaiMsgs = append(oaiMsgs, openai.AssistantMessage(m.Content))
		case RoleTool:
			oaiMsgs = append(oaiMsgs, openai.UserMessage("Tool result: "+m.Content))
		}
	}
	params := openai.ChatCompletionNewParams{
		Model:    p.model,
		Messages: oaiMsgs,
	}
	if p.effort != "" {
		params.ReasoningEffort = p.effort
	}
	if p.maxOutputTokens > 0 {
		params.MaxTokens = openai.Int(p.maxOutputTokens)
	}
	resp, err := p.client.Chat.Completions.New(ctx, params)
	if err != nil {
		return "", TokenUsage{}, err
	}
	text := ""
	if len(resp.Choices) > 0 {
		text = resp.Choices[0].Message.Content
	}
	return text, TokenUsage{
		InputTokens:  resp.Usage.PromptTokens,
		OutputTokens: resp.Usage.CompletionTokens,
	}, nil
}

func openAIUserMessage(m Message) openai.ChatCompletionMessageParamUnion {
	if len(m.Images) == 0 {
		return openai.UserMessage(m.Content)
	}
	parts := make([]openai.ChatCompletionContentPartUnionParam, 0, 1+len(m.Images))
	if m.Content != "" {
		parts = append(parts, openai.TextContentPart(m.Content))
	}
	for _, img := range m.Images {
		parts = append(parts, openai.ImageContentPart(openai.ChatCompletionContentPartImageImageURLParam{
			URL: "data:" + img.MIMEType + ";base64," + img.Data,
		}))
	}
	return openai.UserMessage(parts)
}

func (p *openaiProvider) Model() string {
	return p.model
}

func (p *openaiProvider) MaxContextTokens() int64 {
	if p.contextWindow > 0 {
		return p.contextWindow
	}
	return ModelContextLimit(p.model)
}
