package llm

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/shared"
)

type llmRoundTripFunc func(*http.Request) (*http.Response, error)

func (f llmRoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestOpenAIRequestOptionsUseAzureAPIKeyHeader(t *testing.T) {
	var gotAuth string
	var gotAPIKey string

	client := openai.NewClient(append(openAIRequestOptions(OpenAIConfig{
		APIKey:  "azure-key",
		BaseURL: "https://example.services.ai.azure.com/openai/v1",
	}), option.WithHTTPClient(&http.Client{
		Transport: llmRoundTripFunc(func(req *http.Request) (*http.Response, error) {
			gotAuth = req.Header.Get("Authorization")
			gotAPIKey = req.Header.Get("api-key")
			return chatCompletionResponse(), nil
		}),
	}))...)

	_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
		Model:    "gpt-5.4",
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("hi")},
	})
	if err != nil {
		t.Fatalf("chat completion failed: %v", err)
	}
	if gotAuth != "" {
		t.Fatalf("expected Azure API key auth to omit Authorization header, got %q", gotAuth)
	}
	if gotAPIKey != "azure-key" {
		t.Fatalf("expected api-key header %q, got %q", "azure-key", gotAPIKey)
	}
}

func TestOpenAIRequestOptionsKeepBearerAuthForNonAzureBaseURL(t *testing.T) {
	var gotAuth string
	var gotAPIKey string

	client := openai.NewClient(append(openAIRequestOptions(OpenAIConfig{
		APIKey:  "openai-key",
		BaseURL: "https://proxy.example.com/v1",
	}), option.WithHTTPClient(&http.Client{
		Transport: llmRoundTripFunc(func(req *http.Request) (*http.Response, error) {
			gotAuth = req.Header.Get("Authorization")
			gotAPIKey = req.Header.Get("api-key")
			return chatCompletionResponse(), nil
		}),
	}))...)

	_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
		Model:    "gpt-5.4",
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("hi")},
	})
	if err != nil {
		t.Fatalf("chat completion failed: %v", err)
	}
	if gotAuth != "Bearer openai-key" {
		t.Fatalf("expected bearer auth header, got %q", gotAuth)
	}
	if gotAPIKey != "" {
		t.Fatalf("expected no api-key header, got %q", gotAPIKey)
	}
}

func TestResolveReasoningEffortPrefersContextOverride(t *testing.T) {
	ctx := WithReasoningEffort(context.Background(), "low")
	if got := resolveReasoningEffort(ctx, shared.ReasoningEffortHigh); got != shared.ReasoningEffortLow {
		t.Fatalf("context override should win over fallback: got %q, want %q", got, shared.ReasoningEffortLow)
	}
}

func TestResolveReasoningEffortFallsBackWhenNoOverride(t *testing.T) {
	if got := resolveReasoningEffort(context.Background(), shared.ReasoningEffortMedium); got != shared.ReasoningEffortMedium {
		t.Fatalf("no override should yield fallback: got %q, want %q", got, shared.ReasoningEffortMedium)
	}
}

func TestResolveReasoningEffortIgnoresInvalidOverride(t *testing.T) {
	ctx := WithReasoningEffort(context.Background(), "ridiculous")
	if got := resolveReasoningEffort(ctx, shared.ReasoningEffortHigh); got != shared.ReasoningEffortHigh {
		t.Fatalf("invalid override should be ignored, falling back: got %q, want %q", got, shared.ReasoningEffortHigh)
	}
}

func TestWithReasoningEffortIgnoresEmpty(t *testing.T) {
	ctx := WithReasoningEffort(context.Background(), "")
	if got := ReasoningEffortFromContext(ctx); got != "" {
		t.Fatalf("empty effort should not be tagged: got %q", got)
	}
}

func chatCompletionResponse() *http.Response {
	body := `{
		"id":"chatcmpl-test",
		"object":"chat.completion",
		"created":0,
		"model":"gpt-5.4",
		"choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],
		"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}
	}`
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}
