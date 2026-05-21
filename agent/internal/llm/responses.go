package llm

// OpenAI Responses-API streaming adapter. Gated by
// OpenAIConfig.UseResponsesAPI + a reasoning-capable model. Falls back to
// Chat Completions on fatal errors (see openai.go Stream branching).
//
// Wire shape on the first call:
//
//	POST /v1/responses
//	  instructions: <stable system>\n\n<volatile system>
//	  input: full message history converted to ResponseInputItemUnionParam
//	  tools: function tool definitions
//	  reasoning: {effort: low|medium|high}
//	  store: true
//	  stream: true
//
// On a chained call (PreviousResponseID set in ctx):
//
//	POST /v1/responses
//	  previous_response_id: resp_<prior>
//	  input: messages[ResponsesChain.DeltaStart:] only — the new tool
//	         results / user message since the last response
//	  tools: re-sent (registry may shift between turns)
//	  // instructions intentionally omitted; the server's chain carries
//	  // the prior system context.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/packages/param"
	"github.com/openai/openai-go/responses"
	"github.com/openai/openai-go/shared"
)

// reasoningCapableModel reports whether a model id is on the gpt-5 / o3 /
// o4 / o5 family that the Responses API was designed for. Models outside
// this set work on Responses too but the win (reasoning-block persistence)
// only matters here, so we keep them on Chat Completions for simplicity.
func reasoningCapableModel(model string) bool {
	m := strings.ToLower(strings.TrimSpace(model))
	return strings.HasPrefix(m, "gpt-5") ||
		strings.HasPrefix(m, "o5") ||
		strings.HasPrefix(m, "o3") ||
		strings.HasPrefix(m, "o4")
}

// shouldUseResponses decides whether this call routes through the
// Responses API. The flag must be on, the model reasoning-capable, and
// the sticky fallback flag clear.
func (p *openaiProvider) shouldUseResponses() bool {
	if !p.useResponsesAPI {
		return false
	}
	if p.responsesFallback.Load() {
		return false
	}
	return reasoningCapableModel(p.model)
}

// isResponsesFatal categorises an error from the Responses path as
// "fall back for the rest of this task" or "propagate to the caller".
// Fatal: 404 (endpoint absent), 400 with previous_response_id in the
// error message (server lost the chain). Everything else propagates —
// auth, rate limits, real network failures should not silently swallow.
func (p *openaiProvider) isResponsesFatal(err error) bool {
	if err == nil {
		return false
	}
	var apiErr *openai.Error
	if !errors.As(err, &apiErr) {
		return false
	}
	if apiErr.StatusCode == 404 {
		return true
	}
	if apiErr.StatusCode == 400 {
		msg := strings.ToLower(apiErr.Error())
		if strings.Contains(msg, "previous_response_id") || strings.Contains(msg, "previous response") {
			return true
		}
	}
	return false
}

// streamResponses runs one Responses-API call and translates events into
// the provider-neutral StreamHandler protocol. Returns a populated
// ResponseID when the call completed normally; the loop persists it on
// Entry.LastResponseID to chain the next turn.
func (p *openaiProvider) streamResponses(
	ctx context.Context,
	system SystemPrompt,
	messages []Message,
	tools []ToolDef,
	h StreamHandler,
) (StreamResult, error) {
	chain, hasChain := ResponsesChainFromContext(ctx)

	params := responses.ResponseNewParams{
		Model: shared.ResponsesModel(p.model),
		Store: param.NewOpt(true),
		// Streaming is selected by calling Responses.NewStreaming below;
		// no separate Stream field on the params struct.
	}

	// instructions: only on the first call. With previous_response_id set,
	// the SDK docs warn that prior instructions aren't carried over —
	// re-sending here would just confuse the model mid-conversation.
	if !hasChain {
		instructions := strings.TrimSpace(system.Stable)
		if system.Volatile != "" {
			if instructions != "" {
				instructions += "\n\n"
			}
			instructions += strings.TrimSpace(system.Volatile)
		}
		if instructions != "" {
			params.Instructions = param.NewOpt(instructions)
		}
	}

	// previous_response_id: skip when empty so the SDK omits the field.
	if hasChain && chain.PreviousResponseID != "" {
		params.PreviousResponseID = param.NewOpt(chain.PreviousResponseID)
	}

	// input: full history on first call, delta-only on chained calls.
	startIdx := 0
	if hasChain && chain.DeltaStart > 0 {
		startIdx = chain.DeltaStart
		if startIdx > len(messages) {
			startIdx = len(messages)
		}
	}
	items, err := convertMessagesToResponseInput(messages[startIdx:])
	if err != nil {
		return StreamResult{}, fmt.Errorf("convert input items: %w", err)
	}
	params.Input = responses.ResponseNewParamsInputUnion{OfInputItemList: items}

	// tools: re-sent every call so a mid-task registry change is reflected.
	if len(tools) > 0 {
		params.Tools = convertToolsToResponseTools(tools)
	}

	if effort := resolveReasoningEffort(ctx, p.effort); effort != "" {
		params.Reasoning = shared.ReasoningParam{Effort: effort}
	}
	if p.maxOutputTokens > 0 {
		params.MaxOutputTokens = param.NewOpt(p.maxOutputTokens)
	}

	stream := p.client.Responses.NewStreaming(ctx, params)
	defer stream.Close()

	var (
		responseID   string
		usage        TokenUsage
		finishReason = "end_turn"
		hadToolCall  bool
	)

	for stream.Next() {
		ev := stream.Current()
		switch ev.Type {
		case "response.output_text.delta":
			if text := ev.Delta.OfString; text != "" {
				h.OnTextDelta(text)
			}
		case "response.output_item.done":
			// The SDK accumulates function_call items here with the
			// fully-assembled arguments JSON. Emit them via the
			// neutral handler so the loop dispatches them just like
			// Chat Completions tool calls.
			if ev.Item.Type == "function_call" && ev.Item.CallID != "" {
				args := ev.Item.Arguments
				if args == "" {
					args = "{}"
				}
				h.OnToolUse(ToolCall{
					ID:    ev.Item.CallID,
					Name:  ev.Item.Name,
					Input: json.RawMessage(args),
				})
				hadToolCall = true
			}
		case "response.completed":
			responseID = ev.Response.ID
			usage = TokenUsage{
				InputTokens:     ev.Response.Usage.InputTokens,
				OutputTokens:    ev.Response.Usage.OutputTokens,
				CacheReadTokens: ev.Response.Usage.InputTokensDetails.CachedTokens,
			}
		case "error":
			return StreamResult{}, fmt.Errorf("responses stream error: %s", ev.Message)
		}
	}
	if err := stream.Err(); err != nil {
		return StreamResult{}, err
	}

	if hadToolCall {
		finishReason = "tool_calls"
	}

	return StreamResult{
		StopReason: finishReason,
		Usage:      usage,
		ResponseID: responseID,
		// The assistant turn we just produced isn't appended to the
		// caller's `messages` slice yet — the loop will append it
		// immediately after Stream returns. So the next chained call's
		// DeltaStart should be len(messages)+1.
		ConsumedMessageCount: len(messages) + 1,
	}, nil
}

// convertMessagesToResponseInput maps llm.Message items into the
// Responses-API input shape. Each entry becomes one ResponseInputItem:
//
//   - RoleUser:      EasyInputMessage{role:"user", content:text}
//   - RoleAssistant: one OfMessage entry per non-empty text + one
//                    OfFunctionCall entry per tool call
//   - RoleTool:      OfFunctionCallOutput{call_id, output}
//
// Image inputs aren't yet wired through (Chat Completions still handles
// images; the Responses path is gated to reasoning models which are
// typically used for code, not vision).
func convertMessagesToResponseInput(messages []Message) (responses.ResponseInputParam, error) {
	out := make(responses.ResponseInputParam, 0, len(messages))
	for _, m := range messages {
		switch m.Role {
		case RoleUser:
			content := m.Content
			if content == "" {
				continue
			}
			out = append(out, responses.ResponseInputItemUnionParam{
				OfMessage: &responses.EasyInputMessageParam{
					Role:    responses.EasyInputMessageRoleUser,
					Content: responses.EasyInputMessageContentUnionParam{OfString: param.NewOpt(content)},
				},
			})
		case RoleAssistant:
			if m.Content != "" {
				out = append(out, responses.ResponseInputItemUnionParam{
					OfMessage: &responses.EasyInputMessageParam{
						Role:    responses.EasyInputMessageRoleAssistant,
						Content: responses.EasyInputMessageContentUnionParam{OfString: param.NewOpt(m.Content)},
					},
				})
			}
			for _, tc := range m.ToolCalls {
				args := string(tc.Input)
				if args == "" {
					args = "{}"
				}
				out = append(out, responses.ResponseInputItemUnionParam{
					OfFunctionCall: &responses.ResponseFunctionToolCallParam{
						CallID:    tc.ID,
						Name:      tc.Name,
						Arguments: args,
					},
				})
			}
		case RoleTool:
			if m.ToolCallID == "" {
				continue
			}
			out = append(out, responses.ResponseInputItemUnionParam{
				OfFunctionCallOutput: &responses.ResponseInputItemFunctionCallOutputParam{
					CallID: m.ToolCallID,
					Output: m.Content,
				},
			})
		}
	}
	return out, nil
}

// convertToolsToResponseTools maps the provider-neutral ToolDef slice to
// the Responses-API tool union. Only function tools are emitted; the
// Responses API also supports built-in file_search / web_search / etc.
// but Loom owns its own tool registry, so we never want the model to
// invoke a server-side tool.
func convertToolsToResponseTools(tools []ToolDef) []responses.ToolUnionParam {
	out := make([]responses.ToolUnionParam, len(tools))
	for i, t := range tools {
		out[i] = responses.ToolUnionParam{
			OfFunction: &responses.FunctionToolParam{
				Name:        t.Name,
				Description: param.NewOpt(t.Description),
				Parameters:  t.InputSchema,
				// Strict mode rejects extra/missing fields. Loom's
				// schemas don't enforce all required fields the way the
				// strict validator wants, so opt out for now — same as
				// the Chat Completions path.
				Strict: param.NewOpt(false),
			},
		}
	}
	return out
}

