import { describe, expect, it } from "vitest";
import type { AlwaysAllowRule, ToolCall } from "../shared/protocol";
import { matchAlwaysAllow } from "./rules";

describe("matchAlwaysAllow", () => {
  it("matches tool-scope rules", () => {
    expect(matchAlwaysAllow(call("run_command", { command: "npm test" }), [
      rule({ tool: "run_command", scope: "tool" }),
    ])).toBe(true);
  });

  it("matches run_command command regex rules", () => {
    expect(matchAlwaysAllow(call("run_command", { command: "npm test" }), [
      rule({ tool: "run_command", scope: "argPattern", argKey: "command", pattern: "^npm test$" }),
    ])).toBe(true);
    expect(matchAlwaysAllow(call("run_command", { command: "npm run build" }), [
      rule({ tool: "run_command", scope: "argPattern", argKey: "command", pattern: "^npm test$" }),
    ])).toBe(false);
  });

  it("matches path glob rules", () => {
    expect(matchAlwaysAllow(call("apply_diff", { path: "src/panel/ChatPanel.ts" }), [
      rule({ tool: "apply_diff", scope: "argPattern", argKey: "path", pattern: "src/**/*.ts" }),
    ])).toBe(true);
  });

  it("fails closed for malformed inputs and invalid regex", () => {
    expect(matchAlwaysAllow(call("run_command", { command: "npm test" }), [
      rule({ tool: "run_command", scope: "argPattern", argKey: "command", pattern: "[" }),
    ])).toBe(false);
    expect(matchAlwaysAllow(call("apply_diff", { target: "src/index.ts" }), [
      rule({ tool: "apply_diff", scope: "argPattern", argKey: "path", pattern: "src/**/*.ts" }),
    ])).toBe(false);
  });

  it("does not match other tools", () => {
    expect(matchAlwaysAllow(call("apply_diff", { path: "src/index.ts" }), [
      rule({ tool: "run_command", scope: "tool" }),
    ])).toBe(false);
  });
});

function call(name: string, input: unknown): ToolCall {
  return {
    callId: "call-1",
    taskId: "task-1",
    name,
    input,
    requiresApproval: true,
  };
}

function rule(overrides: Omit<AlwaysAllowRule, "id" | "createdAt">): AlwaysAllowRule {
  return {
    id: "rule-1",
    createdAt: 1,
    ...overrides,
  };
}
