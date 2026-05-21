package llm

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
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
			MaxOutputTokens: parseInt64Env("OPENAI_MAX_OUTPUT_TOKENS"),
			ContextWindow:   parseInt64Env("OPENAI_CONTEXT_WINDOW"),
			CustomHeaders:   parseHeadersEnv("OPENAI_CUSTOM_HEADERS"),
			UseResponsesAPI: parseBoolEnv("OPENAI_USE_RESPONSES"),
		},
		Anthropic: AnthropicConfig{
			APIKey: os.Getenv("ANTHROPIC_API_KEY"),
			Model:  getenvDefault("MY_AGENT_MODEL", "claude-opus-4-7"),
		},
	})
}

// parseBoolEnv accepts "1", "true", "yes", "on" (case-insensitive) as true;
// anything else (including empty) is false. Lenient on input because users
// hand-set this in shell rc files.
func parseBoolEnv(key string) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch v {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

func parseInt64Env(key string) int64 {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return 0
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

func parseHeadersEnv(key string) []HeaderPair {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return nil
	}
	var pairs []HeaderPair
	if err := json.Unmarshal([]byte(raw), &pairs); err != nil {
		return nil
	}
	out := pairs[:0]
	for _, p := range pairs {
		if strings.TrimSpace(p.Name) == "" {
			continue
		}
		out = append(out, p)
	}
	return out
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
