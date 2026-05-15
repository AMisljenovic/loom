import { minimatch } from "minimatch";
import type { AlwaysAllowRule, ToolCall } from "../shared/protocol";

const PATH_ARG_TOOLS = new Set(["apply_diff", "read_file", "list_dir", "search"]);

export function matchAlwaysAllow(call: ToolCall, rules: AlwaysAllowRule[]): boolean {
  return rules.some((rule) => matchesRule(call, rule));
}

function matchesRule(call: ToolCall, rule: AlwaysAllowRule): boolean {
  if (rule.tool !== call.name) {
    return false;
  }
  if (rule.scope === "tool") {
    return true;
  }
  if (rule.scope !== "argPattern" || !rule.pattern) {
    return false;
  }

  if (call.name === "run_command" && rule.argKey === "command") {
    const command = inputString(call.input, "command");
    if (command === undefined) return false;
    try {
      return new RegExp(rule.pattern).test(command);
    } catch {
      return false;
    }
  }

  if (PATH_ARG_TOOLS.has(call.name) && rule.argKey === "path") {
    const relPath = inputString(call.input, "path");
    if (relPath === undefined) return false;
    try {
      return minimatch(relPath, rule.pattern, { dot: true });
    } catch {
      return false;
    }
  }

  return false;
}

function inputString(input: unknown, key: "command" | "path"): string | undefined {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return undefined;
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
