import { describe, expect, it } from "vitest";
import { consumeHostApprovalPolicy } from "./hostPolicy";
import type { ToolCall } from "../shared/protocol";

const call: ToolCall = {
  callId: "c1",
  taskId: "t1",
  name: "mcp__fs__read_file",
  input: { path: "README.md" },
  requiresApproval: true,
};

describe("consumeHostApprovalPolicy", () => {
  it("approves when auto-approve is enabled", () => {
    expect(consumeHostApprovalPolicy(call, {
      autoApprove: true,
      alwaysAllow: [],
      sessionBulkCounters: new Map(),
    })).toBe(true);
  });

  it("approves matching always-allow rules", () => {
    expect(consumeHostApprovalPolicy(call, {
      autoApprove: false,
      alwaysAllow: [{ id: "r1", tool: call.name, scope: "tool", createdAt: 1 }],
      sessionBulkCounters: new Map(),
    })).toBe(true);
  });

  it("consumes session bulk counters", () => {
    const counters = new Map([[call.name, 2]]);
    const state = { autoApprove: false, alwaysAllow: [], sessionBulkCounters: counters };
    expect(consumeHostApprovalPolicy(call, state)).toBe(true);
    expect(counters.get(call.name)).toBe(1);
    expect(consumeHostApprovalPolicy(call, state)).toBe(true);
    expect(counters.has(call.name)).toBe(false);
    expect(consumeHostApprovalPolicy(call, state)).toBe(false);
  });
});
