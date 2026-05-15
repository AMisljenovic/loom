package llm

import (
	"fmt"
	"os"
	"strings"
)

// NewFromEnv builds a Provider from environment variables. Selection:
//
//   MY_AGENT_PROVIDER  "openai" | "anthropic"  (default "anthropic")
//
// OpenAI:
//   OPENAI_API_KEY            required
//   OPENAI_BASE_URL           default https://api.openai.com/v1
//   OPENAI_MODEL              default gpt-5
//   OPENAI_REASONING_EFFORT   "" | "low" | "medium" | "high"
//
// Anthropic:
//   ANTHROPIC_API_KEY  required
//   MY_AGENT_MODEL     default claude-opus-4-7
func NewFromEnv() (Provider, error) {
	provider := strings.ToLower(strings.TrimSpace(os.Getenv("MY_AGENT_PROVIDER")))
	if provider == "" {
		provider = "anthropic"
	}

	switch provider {
	case "openai":
		return newOpenAI(OpenAIConfig{
			APIKey:          os.Getenv("OPENAI_API_KEY"),
			BaseURL:         os.Getenv("OPENAI_BASE_URL"),
			Model:           getenvDefault("OPENAI_MODEL", "gpt-5"),
			ReasoningEffort: os.Getenv("OPENAI_REASONING_EFFORT"),
		})
	case "anthropic":
		return newAnthropic(AnthropicConfig{
			APIKey: os.Getenv("ANTHROPIC_API_KEY"),
			Model:  getenvDefault("MY_AGENT_MODEL", "claude-opus-4-7"),
		})
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
