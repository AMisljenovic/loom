import { isCategoryApproved } from "./categories";
import { matchAlwaysAllow } from "./rules";
import type { AlwaysAllowRule, AutoApproveConfig, ToolCall } from "../shared/protocol";

export interface HostApprovalPolicyState {
  autoApprove: AutoApproveConfig;
  alwaysAllow: AlwaysAllowRule[];
  sessionBulkCounters: Map<string, number>;
}

// Decides whether a tool call may proceed without showing the user the
// approval card. Order:
//   1. category-based auto-approve (master Enabled + per-category opt-in)
//   2. fine-grained alwaysAllow regex/glob rules
//   3. session bulk counters (user pre-approved N calls of this tool)
export function consumeHostApprovalPolicy(call: ToolCall, state: HostApprovalPolicyState): boolean {
  if (isCategoryApproved(call, state.autoApprove)) {
    return true;
  }
  if (matchAlwaysAllow(call, state.alwaysAllow)) {
    return true;
  }
  const remaining = state.sessionBulkCounters.get(call.name) ?? 0;
  if (remaining <= 0) {
    return false;
  }
  if (remaining === 1) {
    state.sessionBulkCounters.delete(call.name);
  } else {
    state.sessionBulkCounters.set(call.name, remaining - 1);
  }
  return true;
}
