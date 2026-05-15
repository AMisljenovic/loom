import { matchAlwaysAllow } from "./rules";
import type { AlwaysAllowRule, ToolCall } from "../shared/protocol";

export interface HostApprovalPolicyState {
  autoApprove: boolean;
  alwaysAllow: AlwaysAllowRule[];
  sessionBulkCounters: Map<string, number>;
}

export function consumeHostApprovalPolicy(call: ToolCall, state: HostApprovalPolicyState): boolean {
  if (state.autoApprove || matchAlwaysAllow(call, state.alwaysAllow)) {
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
