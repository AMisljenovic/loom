import { describe, expect, it } from "vitest";
import { DEFAULT_AUTO_APPROVE_CONFIG } from "./categories";
import { consumeHostApprovalPolicy } from "./hostPolicy";
import type { AutoApproveConfig, ToolCall } from "../shared/protocol";

const call: ToolCall = {
  callId: "c1",
  taskId: "t1",
  name: "mcp__fs__read_file",
  input: { path: "README.md" },
  requiresApproval: true,
};

function configWith(overrides: Partial<AutoApproveConfig["categories"]>, enabled = true): AutoApproveConfig {
  return {
    enabled,
    categories: { ...DEFAULT_AUTO_APPROVE_CONFIG.categories, ...overrides },
  };
}

describe("consumeHostApprovalPolicy", () => {
  it("approves when the relevant category is on", () => {
    expect(consumeHostApprovalPolicy(call, {
      autoApprove: configWith({ mcp: true }),
      alwaysAllow: [],
      sessionBulkCounters: new Map(),
    })).toBe(true);
  });

  it("does not approve when the category is off", () => {
    expect(consumeHostApprovalPolicy(call, {
      autoApprove: configWith({ mcp: false }),
      alwaysAllow: [],
      sessionBulkCounters: new Map(),
    })).toBe(false);
  });

  it("does not approve when the master switch is off, even if the category is on", () => {
    expect(consumeHostApprovalPolicy(call, {
      autoApprove: configWith({ mcp: true }, false),
      alwaysAllow: [],
      sessionBulkCounters: new Map(),
    })).toBe(false);
  });

  it("approves matching always-allow rules even when categories are off", () => {
    expect(consumeHostApprovalPolicy(call, {
      autoApprove: configWith({ mcp: false }),
      alwaysAllow: [{ id: "r1", tool: call.name, scope: "tool", createdAt: 1 }],
      sessionBulkCounters: new Map(),
    })).toBe(true);
  });

  it("consumes session bulk counters when neither category nor rules match", () => {
    const counters = new Map([[call.name, 2]]);
    const state = {
      autoApprove: configWith({ mcp: false }),
      alwaysAllow: [],
      sessionBulkCounters: counters,
    };
    expect(consumeHostApprovalPolicy(call, state)).toBe(true);
    expect(counters.get(call.name)).toBe(1);
    expect(consumeHostApprovalPolicy(call, state)).toBe(true);
    expect(counters.has(call.name)).toBe(false);
    expect(consumeHostApprovalPolicy(call, state)).toBe(false);
  });
});
