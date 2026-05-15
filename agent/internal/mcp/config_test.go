package mcp

import "testing"

func TestMergeConfigsFirstWins(t *testing.T) {
	workspace := Config{Servers: map[string]ServerConfig{
		"fs": {Command: "workspace-fs"},
	}}
	settings := Config{Servers: map[string]ServerConfig{
		"fs":     {Command: "settings-fs"},
		"github": {Command: "settings-gh"},
	}}
	user := Config{Servers: map[string]ServerConfig{
		"github": {Command: "user-gh"},
		"db":     {Command: "user-db"},
	}}

	got, err := MergeConfigs(workspace, settings, user)
	if err != nil {
		t.Fatal(err)
	}
	if got.Servers["fs"].Command != "workspace-fs" {
		t.Fatalf("workspace should win for fs, got %q", got.Servers["fs"].Command)
	}
	if got.Servers["github"].Command != "settings-gh" {
		t.Fatalf("settings should win for github, got %q", got.Servers["github"].Command)
	}
	if got.Servers["db"].Command != "user-db" {
		t.Fatalf("user fallback missing, got %q", got.Servers["db"].Command)
	}
}

func TestSubstituteWorkspaceFolder(t *testing.T) {
	cfg := Config{Servers: map[string]ServerConfig{
		"fs": {
			Command: "${workspaceFolder}/bin/server",
			Args:    []string{"--root", "${workspaceFolder}"},
			Env:     map[string]string{"ROOT": "${workspaceFolder}"},
		},
	}}
	got := SubstituteWorkspaceFolder(cfg, "/repo")
	server := got.Servers["fs"]
	if server.Command != "/repo/bin/server" {
		t.Fatalf("command = %q", server.Command)
	}
	if server.Args[1] != "/repo" {
		t.Fatalf("arg = %q", server.Args[1])
	}
	if server.Env["ROOT"] != "/repo" {
		t.Fatalf("env = %q", server.Env["ROOT"])
	}
}

func TestNormalizeConfigRequiresCommand(t *testing.T) {
	_, err := NormalizeConfig(Config{Servers: map[string]ServerConfig{
		"fs": {},
	}})
	if err == nil {
		t.Fatal("expected error")
	}
}
