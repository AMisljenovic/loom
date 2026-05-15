package llm

import (
	"context"
	"errors"
)

type AnthropicConfig struct {
	APIKey string
	Model  string
}

// Stub. Slots into the Provider interface so MY_AGENT_PROVIDER=anthropic
// fails cleanly with a clear message instead of crashing. Replace this with
// a real anthropic-sdk-go wrapper in a follow-up.
type anthropicProvider struct {
	model string
}

func newAnthropic(cfg AnthropicConfig) (Provider, error) {
	if cfg.APIKey == "" {
		return nil, errors.New("ANTHROPIC_API_KEY is required when MY_AGENT_PROVIDER=anthropic")
	}
	return &anthropicProvider{model: cfg.Model}, nil
}

func (p *anthropicProvider) Stream(
	_ context.Context,
	_ string,
	_ []Message,
	_ []ToolDef,
	_ StreamHandler,
) (string, error) {
	return "", errors.New("anthropic provider not implemented yet — use MY_AGENT_PROVIDER=openai")
}
