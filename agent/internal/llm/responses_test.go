package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
)

// recordHandler captures the URL path and request body of each call so the
// test can assert which endpoint the adapter routed to.
type recordHandler struct {
	calls []recordedCall
	// nextResponse returns the canned (statusCode, body) for the next call.
	// If nil, every call returns 200 + a vanilla streamed response.
	nextResponse func(call int) (status int, body string, contentType string)
}

type recordedCall struct {
	path string
	body string
}

func (r *recordHandler) RoundTrip(req *http.Request) (*http.Response, error) {
	var body string
	if req.Body != nil {
		b, _ := io.ReadAll(req.Body)
		body = string(b)
	}
	r.calls = append(r.calls, recordedCall{
		path: req.URL.Path,
		body: body,
	})

	status := http.StatusOK
	respBody := chatCompletionStreamBody()
	contentType := "text/event-stream"
	if r.nextResponse != nil {
		s, b, ct := r.nextResponse(len(r.calls) - 1)
		if s != 0 {
			status = s
		}
		if b != "" {
			respBody = b
		}
		if ct != "" {
			contentType = ct
		}
	}

	// Pick the streaming body for the responses path.
	if strings.HasSuffix(req.URL.Path, "/responses") && r.nextResponse == nil {
		respBody = responsesStreamBody()
	}

	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{contentType}},
		Body:       io.NopCloser(strings.NewReader(respBody)),
	}, nil
}

// chatCompletionStreamBody returns a minimal SSE Chat Completions stream
// — one delta chunk + a [DONE] marker — enough for the SDK's accumulator
// to finish cleanly with end_turn.
func chatCompletionStreamBody() string {
	return `data: {"id":"chatcmpl-test","object":"chat.completion.chunk","model":"gpt-5.4","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}

data: {"id":"chatcmpl-test","object":"chat.completion.chunk","model":"gpt-5.4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}

data: [DONE]

`
}

// responsesStreamBody returns a minimal SSE Responses stream: one
// text-delta event followed by a response.completed event carrying a
// response_id.
func responsesStreamBody() string {
	return `event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"ok","sequence_number":1}

event: response.completed
data: {"type":"response.completed","sequence_number":2,"response":{"id":"resp_test_123","object":"response","created_at":1.0,"error":null,"incomplete_details":null,"instructions":null,"metadata":null,"model":"gpt-5.4","output":[],"parallel_tool_calls":true,"temperature":null,"tool_choice":"auto","tools":[],"top_p":null,"status":"completed","usage":{"input_tokens":10,"output_tokens":2,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0},"total_tokens":12}}}

`
}

type discardHandler struct{}

func (discardHandler) OnTextDelta(string)  {}
func (discardHandler) OnToolUse(ToolCall)  {}

func newTestProvider(t *testing.T, model string, useResponses bool, rt http.RoundTripper) *openaiProvider {
	t.Helper()
	p, err := newOpenAI(OpenAIConfig{
		APIKey:          "test-key",
		Model:           model,
		BaseURL:         "https://example.test/v1",
		UseResponsesAPI: useResponses,
	})
	if err != nil {
		t.Fatalf("newOpenAI: %v", err)
	}
	// Re-build the client with the captured HTTP transport so we can
	// observe routing.
	opts := append(openAIRequestOptions(OpenAIConfig{
		APIKey:  "test-key",
		BaseURL: "https://example.test/v1",
	}), option.WithHTTPClient(&http.Client{Transport: rt}))
	p.(*openaiProvider).client = openai.NewClient(opts...)
	return p.(*openaiProvider)
}

func TestStreamRoutesToResponsesWhenEnabled(t *testing.T) {
	rec := &recordHandler{}
	p := newTestProvider(t, "gpt-5.4", true, rec)

	_, err := p.Stream(
		context.Background(),
		SystemPrompt{Stable: "stable", Volatile: "vol"},
		[]Message{{Role: RoleUser, Content: "hello"}},
		nil,
		discardHandler{},
	)
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}

	if len(rec.calls) != 1 {
		t.Fatalf("expected exactly one HTTP call, got %d", len(rec.calls))
	}
	if !strings.HasSuffix(rec.calls[0].path, "/responses") {
		t.Fatalf("expected route to /responses, got %s", rec.calls[0].path)
	}
	// instructions must be present on a first call.
	if !strings.Contains(rec.calls[0].body, `"instructions"`) {
		t.Fatalf("first Responses call should send instructions; body=%s", rec.calls[0].body)
	}
}

func TestStreamRoutesToChatCompletionsWhenDisabled(t *testing.T) {
	rec := &recordHandler{}
	p := newTestProvider(t, "gpt-5.4", false, rec)

	_, err := p.Stream(
		context.Background(),
		SystemPrompt{Stable: "stable"},
		[]Message{{Role: RoleUser, Content: "hello"}},
		nil,
		discardHandler{},
	)
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}

	if len(rec.calls) != 1 {
		t.Fatalf("expected exactly one HTTP call, got %d", len(rec.calls))
	}
	if !strings.HasSuffix(rec.calls[0].path, "/chat/completions") {
		t.Fatalf("expected /chat/completions when flag off, got %s", rec.calls[0].path)
	}
}

func TestNonReasoningModelStaysOnChatCompletions(t *testing.T) {
	rec := &recordHandler{}
	// gpt-4o is not a reasoning-capable model — flag should be ignored.
	p := newTestProvider(t, "gpt-4o", true, rec)

	_, err := p.Stream(
		context.Background(),
		SystemPrompt{Stable: "stable"},
		[]Message{{Role: RoleUser, Content: "hi"}},
		nil,
		discardHandler{},
	)
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}

	if !strings.HasSuffix(rec.calls[0].path, "/chat/completions") {
		t.Fatalf("non-reasoning model should stay on /chat/completions, got %s", rec.calls[0].path)
	}
}

func TestResponsesChainSkipsAlreadySentMessages(t *testing.T) {
	rec := &recordHandler{}
	p := newTestProvider(t, "gpt-5.4", true, rec)

	// Chain anchor at message index 2 — only messages[2:] should appear
	// in the request body. Messages 0 and 1 are already server-side.
	ctx := WithResponsesChain(context.Background(), "resp_prior", 2)
	_, err := p.Stream(
		ctx,
		SystemPrompt{Stable: "stable"},
		[]Message{
			{Role: RoleUser, Content: "first user msg (already on server)"},
			{Role: RoleAssistant, Content: "first assistant (already on server)"},
			{Role: RoleTool, ToolCallID: "call_x", Content: "fresh tool result"},
		},
		nil,
		discardHandler{},
	)
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}

	body := rec.calls[0].body
	if !strings.Contains(body, `"previous_response_id":"resp_prior"`) {
		t.Fatalf("chained call should carry previous_response_id; body=%s", body)
	}
	if !strings.Contains(body, "fresh tool result") {
		t.Fatalf("chained call should include the new tool result; body=%s", body)
	}
	if strings.Contains(body, "first user msg") {
		t.Fatalf("chained call leaked already-server-side user message; body=%s", body)
	}
	if strings.Contains(body, "first assistant") {
		t.Fatalf("chained call leaked already-server-side assistant message; body=%s", body)
	}
	// instructions must be omitted on chained calls (SDK docs note prior
	// instructions are not carried over and re-sending swaps them).
	if strings.Contains(body, `"instructions"`) {
		t.Fatalf("chained call should omit instructions; body=%s", body)
	}
}

func TestResponsesFallbackOnFatal404(t *testing.T) {
	// 404 only the very first HTTP call (the /responses probe). Use a
	// running counter independent of recordHandler.calls so resetting
	// rec.calls between Stream invocations doesn't replay the 404.
	totalCalls := 0
	rec := &recordHandler{
		nextResponse: func(_ int) (int, string, string) {
			defer func() { totalCalls++ }()
			if totalCalls == 0 {
				return http.StatusNotFound,
					`{"error":{"message":"not found","type":"invalid_request_error","code":"unknown_endpoint"}}`,
					"application/json"
			}
			return 0, "", ""
		},
	}
	p := newTestProvider(t, "gpt-5.4", true, rec)

	// First Stream call: responses path 404s, fallback engages, second
	// HTTP request goes to /chat/completions. Stream returns the
	// fallback result without error.
	_, err := p.Stream(
		context.Background(),
		SystemPrompt{Stable: "stable"},
		[]Message{{Role: RoleUser, Content: "first"}},
		nil,
		discardHandler{},
	)
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	if len(rec.calls) != 2 {
		t.Fatalf("expected 2 HTTP calls (responses 404 + chat fallback), got %d", len(rec.calls))
	}
	if !strings.HasSuffix(rec.calls[0].path, "/responses") {
		t.Fatalf("first call should be /responses, got %s", rec.calls[0].path)
	}
	if !strings.HasSuffix(rec.calls[1].path, "/chat/completions") {
		t.Fatalf("fallback call should be /chat/completions, got %s", rec.calls[1].path)
	}

	// Second Stream call: the sticky fallback should keep us on
	// /chat/completions without retrying /responses.
	rec.calls = nil
	_, err = p.Stream(
		context.Background(),
		SystemPrompt{Stable: "stable"},
		[]Message{{Role: RoleUser, Content: "second"}},
		nil,
		discardHandler{},
	)
	if err != nil {
		t.Fatalf("second Stream: %v", err)
	}
	if len(rec.calls) != 1 {
		t.Fatalf("after fallback, expected 1 call, got %d", len(rec.calls))
	}
	if !strings.HasSuffix(rec.calls[0].path, "/chat/completions") {
		t.Fatalf("sticky fallback failed; got %s", rec.calls[0].path)
	}
}

func TestResponsesEmitsToolCallsThroughHandler(t *testing.T) {
	rec := &recordHandler{
		nextResponse: func(i int) (int, string, string) {
			body := `event: response.output_item.done
data: {"type":"response.output_item.done","sequence_number":1,"output_index":0,"item":{"id":"item_1","type":"function_call","call_id":"call_abc","name":"read_file","arguments":"{\"path\":\"x\"}","status":"completed"}}

event: response.completed
data: {"type":"response.completed","sequence_number":2,"response":{"id":"resp_tool","object":"response","created_at":1.0,"error":null,"incomplete_details":null,"instructions":null,"metadata":null,"model":"gpt-5.4","output":[],"parallel_tool_calls":true,"temperature":null,"tool_choice":"auto","tools":[],"top_p":null,"status":"completed","usage":{"input_tokens":1,"output_tokens":1,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0},"total_tokens":2}}}

`
			return http.StatusOK, body, "text/event-stream"
		},
	}
	p := newTestProvider(t, "gpt-5.4", true, rec)

	var capturedCalls []ToolCall
	h := capturingHandler{onTool: func(tc ToolCall) { capturedCalls = append(capturedCalls, tc) }}

	res, err := p.Stream(
		context.Background(),
		SystemPrompt{Stable: "s"},
		[]Message{{Role: RoleUser, Content: "go"}},
		[]ToolDef{{Name: "read_file", Description: "d", InputSchema: map[string]any{"type": "object"}}},
		h,
	)
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	if len(capturedCalls) != 1 {
		t.Fatalf("expected one tool call, got %d", len(capturedCalls))
	}
	if capturedCalls[0].ID != "call_abc" || capturedCalls[0].Name != "read_file" {
		t.Fatalf("unexpected tool call: %+v", capturedCalls[0])
	}
	if res.StopReason != "tool_calls" {
		t.Fatalf("expected stop=tool_calls, got %q", res.StopReason)
	}
	if res.ResponseID != "resp_tool" {
		t.Fatalf("expected captured response id, got %q", res.ResponseID)
	}
	// Sanity check: the arguments arrived intact and are valid JSON.
	var args map[string]any
	if err := json.Unmarshal(capturedCalls[0].Input, &args); err != nil {
		t.Fatalf("tool arguments not valid JSON: %v", err)
	}
}

type capturingHandler struct {
	onTool func(ToolCall)
}

func (c capturingHandler) OnTextDelta(string) {}
func (c capturingHandler) OnToolUse(tc ToolCall) {
	if c.onTool != nil {
		c.onTool(tc)
	}
}
