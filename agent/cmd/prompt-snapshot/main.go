// Command prompt-snapshot prints the stable+volatile system prompt for each
// built-in mode, plus built-in sub-agent presets. Output is written under
// docs/prompt-snapshots/<id>-empty.txt and is meant as a regression baseline
// when changing prompt-layer code.
//
// Run from the repo root:
// `go -C agent run ./cmd/prompt-snapshot --out ../docs/prompt-snapshots`.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/your-org/loom/internal/loop"
	"github.com/your-org/loom/internal/rules"
	"github.com/your-org/loom/internal/skills"
	"github.com/your-org/loom/internal/tools"
)

// Mode definitions mirror src/modes.ts (BUILTIN_MODES). Keep in sync.
var modes = []loop.ModeDefinition{
	{ID: "code", Label: "Code"},
	{
		ID:    "architect",
		Label: "Architect",
		ToolDenylist: []string{
			"apply_diff",
			"run_command",
			"run_command_background",
			"kill_process",
		},
	},
	{
		ID:    "ask",
		Label: "Ask",
		ToolAllowlist: []string{
			"read_file",
			"list_dir",
			"search",
			"find_symbol",
			"find_references",
			"semantic_search",
			"get_diagnostics",
			"load_skill",
			"spawn_subagent",
		},
	},
	{ID: "debug", Label: "Debug"},
}

func main() {
	outDir := flag.String("out", "docs/prompt-snapshots", "output directory")
	check := flag.Bool("check", false, "verify existing snapshots are byte-stable (no writes)")
	flag.Parse()

	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		fail("mkdir %s: %v", *outDir, err)
	}

	// Empty workspace, no rules, no loaded skills — true "fresh task" baseline.
	cat := skills.Load("")
	presets := loop.LoadPresets("")
	bundle := rules.Bundle{}

	// Mode prompts.
	for _, m := range modes {
		mode := m
		registry := loop.ApplyMode(tools.Registry(), &mode)
		stable := loop.BuildStableSystem(&mode, registry, cat, presets.All())
		volatile := loop.BuildVolatileSystem("", cat, nil, bundle, nil)

		path := filepath.Join(*outDir, m.ID+"-empty.txt")
		writeOrCheck(path, render(m.ID, stable, volatile), *check)
	}

	// Built-in sub-agent presets.
	for _, preset := range presets.All() {
		if preset.Source != "builtin" {
			continue
		}
		subMode := loop.ModeDefinition{
			ID:            preset.Name,
			Label:         preset.Name,
			SystemPrompt:  preset.SystemPrompt,
			ToolAllowlist: preset.AllowedTools,
		}
		subRegistry := loop.ApplyMode(tools.Registry(), &subMode)
		subStable := loop.BuildStableSystem(&subMode, subRegistry, cat, nil)
		subVolatile := loop.BuildVolatileSystem("", cat, nil, bundle, nil)
		writeOrCheck(
			filepath.Join(*outDir, preset.Name+"-empty.txt"),
			render(preset.Name+" (sub-agent)", subStable, subVolatile),
			*check,
		)
	}

	if *check {
		fmt.Fprintln(os.Stderr, "prompt-snapshot: all snapshots match")
	} else {
		fmt.Fprintln(os.Stderr, "prompt-snapshot: wrote snapshots to", *outDir)
	}
}

func render(id, stable, volatile string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Prompt snapshot — %s\n", id)
	b.WriteString("# Empty workspace, no rules, no loaded skills.\n")
	b.WriteString("# === STABLE PREFIX (cached) ===\n")
	b.WriteString(stable)
	b.WriteString("\n# === VOLATILE TAIL (per-turn) ===\n")
	b.WriteString(volatile)
	b.WriteString("\n")
	return b.String()
}

func writeOrCheck(path, content string, check bool) {
	if check {
		existing, err := os.ReadFile(path)
		if err != nil {
			fail("read %s: %v", path, err)
		}
		if string(existing) != content {
			fail("snapshot drift: %s", path)
		}
		return
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		fail("write %s: %v", path, err)
	}
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "prompt-snapshot: "+format+"\n", args...)
	os.Exit(1)
}
