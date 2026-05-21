import type { ModeDefinition } from "./shared/protocol";

// Built-in modes. Tool gating mirrors the per-mode prompt files under
// agent/internal/prompts/*.md. New tools must be added here AND to the
// per-mode prompt that lists them, otherwise the model will hallucinate
// capabilities it does not have.
export const BUILTIN_MODES: ModeDefinition[] = [
    {
        id: "code",
        label: "Code",
        // No allowlist or denylist → full registry.
        // Default to "low" reasoning: most code-mode turns are mechanical
        // (read narrow slice → apply_diff). Architect/research escalate.
        reasoningEffort: "low",
    },
    {
        id: "architect",
        label: "Architect",
        // Read-only planning mode: deny everything that writes or executes.
        // load_skill, get_diagnostics, and read_process_output remain available
        // so the agent can inspect state and pull in guidance.
        toolDenylist: [
            "apply_diff",
            "run_command",
            "run_command_background",
            "kill_process",
        ],
        reasoningEffort: "medium",
    },
    {
        id: "ask",
        label: "Ask",
        // Conversational mode used to be empty (no tools at all). Promoted to
        // "read-only with skills" so grounded answers are possible without
        // letting the agent touch the workspace.
        toolAllowlist: [
            "read_file",
            "list_dir",
            "search",
            "find_symbol",
            "find_references",
            "semantic_search",
            "get_diagnostics",
            "load_skill",
            "ask_questions",
            "spawn_subagent",
        ],
        reasoningEffort: "low",
    },
    {
        id: "debug",
        label: "Debug",
        // Full registry — debugging frequently needs writes (instrumentation
        // logging) and long-running processes (test watchers, dev servers).
        reasoningEffort: "low",
    },
];

export function mergeModes(
    builtins: ModeDefinition[],
    userModes: ModeDefinition[],
): ModeDefinition[] {
    const merged = new Map<string, ModeDefinition>(builtins.map((m) => [m.id, m]));
    for (const m of userModes) {
        merged.set(m.id, m);
    }
    return Array.from(merged.values());
}
