package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type ServerConfig struct {
	Command string            `json:"command"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
}

type Config struct {
	Servers map[string]ServerConfig `json:"servers"`
}

func ParseConfig(raw json.RawMessage) (Config, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return Config{Servers: map[string]ServerConfig{}}, nil
	}
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return Config{}, err
	}
	if cfg.Servers == nil {
		cfg.Servers = map[string]ServerConfig{}
	}
	return NormalizeConfig(cfg)
}

func NormalizeConfig(cfg Config) (Config, error) {
	out := Config{Servers: make(map[string]ServerConfig, len(cfg.Servers))}
	for name, server := range cfg.Servers {
		name = strings.TrimSpace(name)
		if name == "" {
			return Config{}, fmt.Errorf("mcp server name must not be empty")
		}
		server.Command = strings.TrimSpace(server.Command)
		if server.Command == "" {
			return Config{}, fmt.Errorf("mcp server %q requires command", name)
		}
		if server.Env == nil {
			server.Env = map[string]string{}
		}
		out.Servers[name] = server
	}
	return out, nil
}

func MergeConfigs(configs ...Config) (Config, error) {
	merged := Config{Servers: map[string]ServerConfig{}}
	for _, cfg := range configs {
		normalized, err := NormalizeConfig(cfg)
		if err != nil {
			return Config{}, err
		}
		for name, server := range normalized.Servers {
			if _, exists := merged.Servers[name]; !exists {
				merged.Servers[name] = server
			}
		}
	}
	return merged, nil
}

func SubstituteWorkspaceFolder(cfg Config, workspaceRoot string) Config {
	replace := func(value string) string {
		return strings.ReplaceAll(value, "${workspaceFolder}", workspaceRoot)
	}
	out := Config{Servers: make(map[string]ServerConfig, len(cfg.Servers))}
	for name, server := range cfg.Servers {
		next := ServerConfig{
			Command: replace(server.Command),
			Args:    make([]string, len(server.Args)),
			Env:     make(map[string]string, len(server.Env)),
		}
		for i, arg := range server.Args {
			next.Args[i] = replace(arg)
		}
		for key, value := range server.Env {
			next.Env[key] = replace(value)
		}
		out.Servers[name] = next
	}
	return out
}

func envWithOverrides(overrides map[string]string) []string {
	env := os.Environ()
	for key, value := range overrides {
		env = append(env, key+"="+value)
	}
	return env
}
