// Wire protocol between extension <-> Go agent (JSON-RPC 2.0)
// and extension <-> webview (postMessage).

export type TaskId = string;
export type CallId = string;

// ---- Extension <-> Go agent ----

export interface TaskStartParams {
  taskId: TaskId;
  conversationId: string;
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
  durationMs?: number;
}

export interface TaskDone {
  taskId: TaskId;
  reason: "completed" | "cancelled" | "error";
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TaskUsage extends TokenUsage {
  taskId: TaskId;
  cumulativeInput: number;
  cumulativeOutput: number;
  model: string;
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface LlmMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: LlmToolCall[];
  toolCallId?: string;
}

export interface ConversationUsage {
  inputTokens: number;
  outputTokens: number;
  model?: string;
}

export interface ConversationState {
  conversationId: string;
  messages: Msg[];
  llmMessages: LlmMessage[];
  usage: ConversationUsage;
  lastInputTokens?: number;
  lastOutputTokens?: number;
}

export interface ConversationUpdated {
  conversationId: string;
  messages: LlmMessage[];
  cumulativeInput: number;
  cumulativeOutput: number;
  lastInputTokens: number;
  lastOutputTokens: number;
  model: string;
}

export interface TaskSummarized {
  taskId: TaskId;
  conversationId: string;
  droppedCount: number;
}

// ---- Webview <-> Extension ----

export type ToolStatus = "pending" | "approved" | "rejected" | "running" | "done" | "error";

export type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | {
    role: "tool";
    name: string;
    status: ToolStatus;
    callId: string;
    input?: unknown;
    output?: string;
    durationMs?: number;
    expanded?: boolean;
  };

export type WebviewToHost =
  | { type: "ready" }
  | { type: "submit"; prompt: string }
  | { type: "cancel" }
  | { type: "newConversation" }
  | { type: "approve"; callId: CallId; approved: boolean };

export type HostToWebview =
  | { type: "delta"; text: string }
  | { type: "toolCall"; call: ToolCall }
  | { type: "toolProgress"; callId: CallId; chunk: string }
  | { type: "toolResult"; callId: CallId; ok: boolean; summary: string; durationMs: number }
  | { type: "done"; reason: TaskDone["reason"] }
  | { type: "restore"; messages: Msg[]; conversationId: string; usage: ConversationUsage }
  | { type: "usage"; usage: ConversationUsage }
  | { type: "summarized"; droppedCount: number }
  | { type: "error"; error: string };
