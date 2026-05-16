import type { AutoApproveCategory, AutoApproveConfig, ToolCall } from "../shared/protocol";

// Tool→category mapping. Tools not listed here fall into "mcp" by default
// (matching the heuristic that the Go agent reports MCP tools with an
// `mcp__` prefix). Keep this list aligned with agent/internal/tools/tools.go
// and src/tools/processes.ts.
const TOOL_CATEGORY: Record<string, AutoApproveCategory> = {
  read_file: "read",
  list_dir: "read",
  search: "read",
  find_symbol: "read",
  find_references: "read",
  semantic_search: "read",
  get_diagnostics: "read",
  read_process_output: "read",
  load_skill: "read",
  spawn_subagent: "subtasks",
  apply_diff: "write",
  run_command: "execute",
  run_command_background: "execute",
  kill_process: "execute",
};

export function categoryForTool(name: string): AutoApproveCategory {
  const direct = TOOL_CATEGORY[name];
  if (direct) return direct;
  // MCP servers expose tools under the `mcp__<server>__<tool>` namespace
  // (see agent/internal/mcp/tools.go); fall back to that bucket here.
  if (name.startsWith("mcp__")) return "mcp";
  // Unknown tools default to "mcp" rather than auto-approving; safer.
  return "mcp";
}

export const DEFAULT_AUTO_APPROVE_CONFIG: AutoApproveConfig = {
  enabled: true,
  categories: {
    read: true,
    write: false,
    execute: false,
    mcp: false,
    mode: true,
    subtasks: false,
    question: true,
  },
};

export const ALL_CATEGORIES: AutoApproveCategory[] = [
  "read",
  "write",
  "mcp",
  "mode",
  "subtasks",
  "execute",
  "question",
];

// Migrates the legacy boolean workspaceState value to the new config.
export function migrateAutoApprove(legacy: unknown): AutoApproveConfig {
  if (legacy && typeof legacy === "object" && "categories" in (legacy as object)) {
    return normalizeAutoApprove(legacy as Partial<AutoApproveConfig>);
  }
  if (legacy === true) {
    return {
      enabled: true,
      categories: { read: true, write: true, execute: true, mcp: true, mode: true, subtasks: false, question: true },
    };
  }
  // false or undefined → defaults
  return { ...DEFAULT_AUTO_APPROVE_CONFIG, categories: { ...DEFAULT_AUTO_APPROVE_CONFIG.categories } };
}

export function normalizeAutoApprove(input: Partial<AutoApproveConfig>): AutoApproveConfig {
  const base: AutoApproveConfig = {
    enabled: Boolean(input.enabled),
    categories: { ...DEFAULT_AUTO_APPROVE_CONFIG.categories },
  };
  if (input.categories && typeof input.categories === "object") {
    for (const c of ALL_CATEGORIES) {
      const v = (input.categories as Record<string, unknown>)[c];
      if (typeof v === "boolean") base.categories[c] = v;
    }
  }
  return base;
}

export function isCategoryApproved(call: ToolCall, config: AutoApproveConfig): boolean {
  if (!config.enabled) return false;
  return config.categories[categoryForTool(call.name)] === true;
}
