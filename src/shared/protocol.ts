// Wire protocol between extension <-> Go agent (JSON-RPC 2.0)
// and extension <-> webview (postMessage).

export type TaskId = string;
export type CallId = string;
export type LlmProvider = "openai" | "anthropic" | "local";
export type AgentLlmProvider = "openai" | "anthropic";
export type ReasoningEffort = "" | "low" | "medium" | "high";

export interface LlmConfigView {
  provider: LlmProvider;
  model: string;
  baseUrl?: string;
  reasoningEffort?: ReasoningEffort;
  hasApiKey?: boolean;
  apiKeys?: {
    anthropic: boolean;
    openai: boolean;
  };
}

// ---- Extension <-> Go agent ----

export interface ConfigUpdateParams {
  provider: AgentLlmProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  reasoningEffort?: ReasoningEffort;
}

export type ConfigUpdateResult =
  | { ok: true }
  | { ok: false; error: string };

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

export type McpConfigureResult =
  | { ok: true }
  | { ok: false; error: string };

export interface McpServerStatus {
  server: string;
  state: "starting" | "ready" | "stopped" | "crashed" | "error" | "failed";
  message?: string;
  toolCount?: number;
  attempt?: number;
}

export interface ModeDefinition {
  id: string;
  label: string;
  systemPromptPath?: string;
  systemPrompt?: string;
  toolDenylist?: string[];
  toolAllowlist?: string[];
}

export interface TaskStartParams {
  taskId: TaskId;
  conversationId: string;
  prompt: string;
  workspaceRoot: string;
  cwd: string;
  mode?: ModeDefinition;
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

export type AlwaysAllowRule = {
  id: string;
  tool: string;
  scope: "tool" | "argPattern";
  pattern?: string;
  argKey?: "command" | "path";
  createdAt: number;
};

export interface ToolResult {
  callId: CallId;
  ok: boolean;
  content?: string;
  error?: string;
  durationMs?: number;
}

export interface ToolApprovalResult {
  approved: boolean;
}

export interface ToolApprovalItem {
  callId: CallId;
  name: string;
  input: unknown;
}

export interface ToolApproveBatchParams {
  taskId: TaskId;
  batchId: string;
  items: ToolApprovalItem[];
}

export interface ToolApproveBatchResult {
  decisions: Record<string, "approved" | "rejected">;
}

export interface IndexStatusNotify {
  state: "scanning" | "ready" | "updating" | "disabled";
  filesScanned: number;
  symbolsCount: number;
  workspaceRoot?: string;
}

export interface IndexInvalidateParams {
  paths: string[];
}

export interface TaskDone {
  taskId: TaskId;
  reason: "completed" | "cancelled" | "error";
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export interface TaskUsage extends TokenUsage {
  taskId: TaskId;
  cumulativeInput: number;
  cumulativeOutput: number;
  cumulativeCacheRead?: number;
  cumulativeCacheWrite?: number;
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
  cacheReadTokens?: number;
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
  cumulativeCacheRead?: number;
  cumulativeCacheWrite?: number;
  lastInputTokens: number;
  lastOutputTokens: number;
  model: string;
  llmConfig?: LlmConfigView;
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

export interface SessionMeta {
  conversationId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  state: "active" | "archived";
  pinned: boolean;
}

export interface SessionsIndex {
  version: 1;
  activeId: string;
  order: string[];
  sessions: Record<string, SessionMeta>;
}

export type WebviewToHost =
  | { type: "ready" }
  | { type: "submit"; prompt: string }
  | { type: "cancel" }
  | { type: "newConversation" }
  | { type: "switchSession"; conversationId: string }
  | { type: "archiveSession"; conversationId: string }
  | { type: "unarchiveSession"; conversationId: string }
  | { type: "togglePinSession"; conversationId: string }
  | { type: "renameSession"; conversationId: string; title: string }
  | { type: "deleteSession"; conversationId: string }
  | { type: "setLlmConfig"; config: Omit<LlmConfigView, "hasApiKey"> }
  | { type: "setSecret"; provider: Exclude<LlmProvider, "local">; apiKey: string }
  | { type: "approve"; callId: CallId; approved: boolean; rememberRule?: AlwaysAllowRule; sessionCount?: number }
  | { type: "setAutoApprove"; enabled: boolean }
  | { type: "removeAlwaysAllowRule"; id: string }
  | { type: "requestAlwaysAllowList" }
  | { type: "setMode"; modeId: string };

export type HostToWebview =
  | { type: "delta"; text: string }
  | { type: "toolCall"; call: ToolCall }
  | { type: "diffPreview"; callId: CallId; relPath: string; unified: string }
  | { type: "toolProgress"; callId: CallId; chunk: string }
  | { type: "toolResult"; callId: CallId; ok: boolean; summary: string; durationMs: number }
  | { type: "done"; reason: TaskDone["reason"] }
  | { type: "restore"; messages: Msg[]; conversationId: string; usage: ConversationUsage; llmConfig: LlmConfigView }
  | { type: "llmConfig"; llmConfig: LlmConfigView }
  | { type: "autoApprove"; enabled: boolean }
  | { type: "alwaysAllowList"; rules: AlwaysAllowRule[] }
  | { type: "usage"; usage: ConversationUsage }
  | { type: "mcpStatus"; status: McpServerStatus }
  | { type: "indexStatus"; status: IndexStatusNotify }
  | { type: "sessions"; index: SessionsIndex }
  | { type: "summarized"; droppedCount: number }
  | { type: "error"; error: string }
  | { type: "modes"; modes: ModeDefinition[]; currentModeId: string }
  | { type: "themeConfig"; accent: string; density: string; themeBias: string };
