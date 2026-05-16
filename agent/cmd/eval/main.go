package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/your-org/loom/internal/eval"
	"github.com/your-org/loom/internal/llm"
)

func main() {
	scenarioName := flag.String("scenario", "", "run only one scenario by name")
	jsonOut := flag.Bool("json", false, "print JSON result")
	maxTurns := flag.Int("max-turns", 10, "maximum LLM turns per scenario")
	flag.Parse()

	provider, err := llm.NewFromEnv()
	if err != nil {
		fail("llm init: %v", err)
	}

	scenarios := eval.Scenarios()
	if *scenarioName != "" {
		s, ok := eval.ScenarioByName(*scenarioName)
		if !ok {
			fail("unknown scenario %q", *scenarioName)
		}
		scenarios = []eval.Scenario{s}
	}

	runner := eval.Runner{Provider: provider, Options: eval.Options{MaxTurns: *maxTurns}}
	results := make([]eval.RunResult, 0, len(scenarios))
	failed := 0
	started := time.Now()
	for _, s := range scenarios {
		result, err := runner.Run(context.Background(), s)
		if err != nil {
			result = eval.RunResult{Name: s.Name, Passed: false, Failures: []string{err.Error()}}
		}
		if !result.Passed {
			failed++
		}
		results = append(results, result)
		if !*jsonOut {
			printResult(result)
		}
	}

	if *jsonOut {
		payload := struct {
			Passed         bool             `json:"passed"`
			Failed         int              `json:"failed"`
			DurationMillis int64            `json:"durationMillis"`
			Results        []eval.RunResult `json:"results"`
		}{
			Passed:         failed == 0,
			Failed:         failed,
			DurationMillis: time.Since(started).Milliseconds(),
			Results:        results,
		}
		b, _ := json.MarshalIndent(payload, "", "  ")
		fmt.Println(string(b))
	}
	if failed > 0 {
		os.Exit(1)
	}
}

func printResult(r eval.RunResult) {
	status := "PASS"
	if !r.Passed {
		status = "FAIL"
	}
	fmt.Printf("%s %s (%dms)\n", status, r.Name, r.DurationMillis)
	if r.TranscriptPath != "" {
		fmt.Printf("  transcript: %s\n", r.TranscriptPath)
	}
	for _, f := range r.Failures {
		fmt.Printf("  - %s\n", f)
	}
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "loom eval: "+format+"\n", args...)
	os.Exit(1)
}
