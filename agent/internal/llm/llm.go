package llm

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	Provider  string
	OpenAI    OpenAIConfig
	Anthropic AnthropicConfig
}

// NewFromEnv builds a Provider from environment variables. Selection:
//
//	MY_AGENT_PROVIDER  "openai" | "anthropic"  (default "anthropic")
//
// OpenAI:
//
//	OPENAI_API_KEY            required
//	OPENAI_BASE_URL           default https://api.openai.com/v1
//	OPENAI_MODEL              default gpt-5
//	OPENAI_REASONING_EFFORT   "" | "low" | "medium" | "high"
//
// Anthropic:
//
//	ANTHROPIC_API_KEY  required
//	MY_AGENT_MODEL     default claude-opus-4-7
func NewFromEnv() (Provider, error) {
	return New(Config{
		Provider: strings.ToLower(strings.TrimSpace(os.Getenv("MY_AGENT_PROVIDER"))),
		OpenAI: OpenAIConfig{
			APIKey:          os.Getenv("OPENAI_API_KEY"),
			BaseURL:         os.Getenv("OPENAI_BASE_URL"),
			Model:           getenvDefault("OPENAI_MODEL", "gpt-5"),
			ReasoningEffort: os.Getenv("OPENAI_REASONING_EFFORT"),
		},
		Anthropic: AnthropicConfig{
			APIKey: os.Getenv("ANTHROPIC_API_KEY"),
			Model:  getenvDefault("MY_AGENT_MODEL", "claude-opus-4-7"),
		},
	})
}

func New(cfg Config) (Provider, error) {
	provider := strings.ToLower(strings.TrimSpace(cfg.Provider))
	if provider == "" {
		provider = "anthropic"
	}

	switch provider {
	case "openai":
		return newOpenAI(cfg.OpenAI)
	case "anthropic":
		return newAnthropic(cfg.Anthropic)
	default:
		return nil, fmt.Errorf("unknown MY_AGENT_PROVIDER %q (expected openai or anthropic)", provider)
	}
}

func getenvDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
