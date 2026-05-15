// Wire protocol between extension <-> Go agent (JSON-RPC 2.0)
// and extension <-> webview (postMessage).

export type TaskId = string;
export type CallId = string;

// ---- Extension <-> Go agent ----

export interface TaskStartParams {
  taskId: TaskId;
  prompt: string;
  workspaceRoot: string;
  cwd: string;
}

export interface MessageDelta {
  taskId: TaskId;
  text: string;
}

export interface ToolCall {
  callId: CallId;
  taskId: TaskId;
  name: string;
  input: unknown;
  requiresApproval: boolean;
}

export interface ToolResult {
  callId: CallId;
  ok: boolean;
  content?: string;
  error?: string;
}

export interface TaskDone {
  taskId: TaskId;
  reason: "completed" | "cancelled" | "error";
}

// ---- Webview <-> Extension ----

export type WebviewToHost =
  | { type: "submit"; prompt: string }
  | { type: "cancel" }
  | { type: "approve"; callId: CallId; approved: boolean };

export type HostToWebview =
  | { type: "delta"; text: string }
  | { type: "toolCall"; call: ToolCall }
  | { type: "toolResult"; callId: CallId; ok: boolean; summary: string }
  | { type: "done"; reason: TaskDone["reason"] }
  | { type: "error"; error: string };
