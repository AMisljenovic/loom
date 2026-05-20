// Wire protocol between extension <-> Go agent (JSON-RPC 2.0)
// and extension <-> webview (postMessage).

export type TaskId = string;
export type CallId = string;
export type LlmProvider = "openai" | "anthropic" | "local" | "openai-compatible";
export type AgentLlmProvider = "openai" | "anthropic";
export type ReasoningEffort = "" | "low" | "medium" | "high";

export interface CustomHeader {
  name: string;
  value: string;
}

// Advanced per-config options exposed by the Settings view. All optional;
// blank fields fall back to provider defaults.
export interface AdvancedLlmOptions {
  // Max tokens the model may generate. -1 / undefined => server default.
  maxOutputTokens?: number;
  // Override the model's known context window. Blank => use ModelContextLimit.
  contextWindow?: number;
  // Reasoning effort for reasoning-capable OpenAI / openai-compatible models.
  reasoningEffort?: ReasoningEffort;
  // Extra HTTP headers added to every outbound LLM request.
  customHeaders?: CustomHeader[];
}

export interface LlmConfigView {
  provider: LlmProvider;
  model: string;
  baseUrl?: string;
  // Legacy top-level field, kept for backward compatibility with persisted
  // state. New code should read advanced.reasoningEffort.
  reasoningEffort?: ReasoningEffort;
  advanced?: AdvancedLlmOptions;
  hasApiKey?: boolean;
  apiKeys?: {
    anthropic: boolean;
    openai: boolean;
    "openai-compatible": boolean;
  };
}

// ---- Extension <-> Go agent ----

export interface ConfigUpdateParams {
  provider: AgentLlmProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  reasoningEffort?: ReasoningEffort;
  maxOutputTokens?: number;
  contextWindow?: number;
  customHeaders?: CustomHeader[];
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
  references?: ReferenceAttachment[];
  // Optional per-task override of the default model/tool turn cap (32).
  // Set when the webview resumes a turn_limit-stopped task via Continue so
  // each resume doubles the budget (32 → 64 → 128 → …).
  maxTurns?: number;
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
  subAgent?: {
    type: string;
    task: string;
  };
}

export type QuestionKind = "single" | "multiple";

export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface QuestionSpec {
  id: string;
  question: string;
  kind: QuestionKind;
  options: QuestionOption[];
}

export interface AskQuestionsInput {
  title?: string;
  questions: QuestionSpec[];
}

export interface QuestionAnswer {
  questionId: string;
  selectedOptionIds: string[];
  otherText?: string;
}

export type ReferenceKind = "file" | "folder" | "image";

export interface PathReferenceAttachment {
  id: string;
  kind: "file" | "folder";
  path: string;
  label?: string;
}

export interface ImageReferenceAttachment {
  id: string;
  kind: "image";
  label?: string;
  mimeType: string;
  data: string;
  size: number;
}

export type ReferenceAttachment = PathReferenceAttachment | ImageReferenceAttachment;

export interface ReferencePack {
  id: string;
  name: string;
  refs: ReferenceAttachment[];
  createdAt: number;
  updatedAt: number;
}

export interface ReferencePacksIndex {
  version: 1;
  order: string[];
  packs: Record<string, ReferencePack>;
}

export type ProgressPhase =
  | "started"
  | "thinking"
  | "reading"
  | "searching"
  | "changing"
  | "executing"
  | "researching"
  | "waiting"
  | "writing"
  | "completed";

// Categories used by the granular auto-approve UI. Tools belong to exactly
// one category (see src/approval/categories.ts). MCP tools are bucketed
// under "mcp" regardless of what they do; users wanting finer control can
// still add alwaysAllow patterns underneath.
export type AutoApproveCategory =
  | "read"
  | "write"
  | "execute"
  | "mcp"
  | "mode"
  | "subtasks"
  | "question";

export interface AutoApproveConfig {
  // Master switch. When false, every approval-gated tool prompts.
  enabled: boolean;
  // Per-category opt-in. A category being true means "skip the prompt for
  // tools in this bucket"; false means prompt.
  categories: Record<AutoApproveCategory, boolean>;
}

export type AlwaysAllowRule = {
  id: string;
  tool: string;
  scope: "tool" | "argPattern";
  pattern?: string;
  argKey?: "command" | "path";
  createdAt: number;
};

export interface ToolFollowupDiagRow {
  line: number;
  col: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
}

export type ToolFollowup =
  | {
    kind: "diagnostics";
    path: string;
    diags: ToolFollowupDiagRow[];
  };

export interface ToolResult {
  callId: CallId;
  ok: boolean;
  content?: string;
  error?: string;
  durationMs?: number;
  // Side-channel results the loop should surface as a synthetic user message
  // on the next turn (e.g. new diagnostics introduced by apply_diff). Empty
  // or omitted means "nothing to report".
  followups?: ToolFollowup[];
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

export interface ProcessSnapshot {
  processId: string;
  command: string;
  cwd: string;
  shell: string;
  shellExecutable: string;
  startedAt: number;
  running: boolean;
  exitCode?: number;
  exitedAt?: number;
  totalBytes: number;
  tailOutput?: string;
}

export interface IndexInvalidateParams {
  paths: string[];
}

export interface TaskDone {
  taskId: TaskId;
  reason: "completed" | "cancelled" | "error" | "turn_limit";
  error?: string;
  maxTurns?: number;
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
  subAgentInputTokens?: number;
  subAgentOutputTokens?: number;
  subAgentCount?: number;
  model: string;
  promptVersion?: string;
}

export interface SubAgentSpawn {
  parentTaskId: string;
  subTaskId: string;
  type: string;
  task: string;
  promptVersion?: string;
}

export interface SubAgentDone {
  subTaskId: string;
  status: "completed" | "cancelled" | "error";
  summary: string;
  toolCalls: number;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  truncated?: boolean;
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface LlmMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  images?: ImageReferenceAttachment[];
  toolCalls?: LlmToolCall[];
  toolCallId?: string;
}

export interface ConversationUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  subAgentInputTokens?: number;
  subAgentOutputTokens?: number;
  subAgentCount?: number;
  model?: string;
  promptVersion?: string;
}

export interface ConversationState {
  conversationId: string;
  messages: Msg[];
  llmMessages: LlmMessage[];
  usage: ConversationUsage;
  lastInputTokens?: number;
  lastOutputTokens?: number;
}

export interface FirstRunState {
  completed: boolean;
  needsSetup: boolean;
  llmConfig: LlmConfigView;
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
export type TodoStatus = "pending" | "in_progress" | "done" | "cancelled";

export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
}

export type Msg =
  | { role: "user"; text: string; references?: ReferenceAttachment[]; command?: CommandInvocation }
  | { role: "assistant"; text: string; kind?: "intent" | "summary" | "error" }
  | { role: "progress"; text: string; phase: ProgressPhase; createdAt: number }
  | { role: "todo"; taskId: string; title?: string; items: TodoItem[] }
  | {
    role: "stop";
    taskId?: string;
    title: string;
    text: string;
    reason: Exclude<TaskDone["reason"], "completed">;
    durationMs?: number;
    canContinue: boolean;
    continuePrompt?: string;
    // For turn_limit stops, the cap the task hit. Continue uses this to
    // request twice the budget on resume; absent on other stop reasons.
    maxTurns?: number;
  }
  | {
    role: "tool";
    name: string;
    status: ToolStatus;
    callId: string;
    input?: unknown;
    output?: string;
    durationMs?: number;
    expanded?: boolean;
  }
  | {
    role: "question";
    callId: string;
    title?: string;
    questions: QuestionSpec[];
    status: "pending" | "answered" | "cancelled";
    answers?: QuestionAnswer[];
  }
  | {
    role: "subagent";
    subTaskId: string;
    parentTaskId: string;
    type: string;
    task: string;
    status: "running" | "completed" | "cancelled" | "error";
    summary?: string;
    toolCalls?: number;
    tokensUsed?: number;
    inputTokens?: number;
    outputTokens?: number;
    truncated?: boolean;
    expanded?: boolean;
    trace: Msg[];
  };

export interface SessionMeta {
  conversationId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  state: "active" | "archived";
  pinned: boolean;
  parent?: { conversationId: string; messageIndex: number };
}

export interface SessionSearchMatch {
  messageIndex: number;
  snippet: string;
}

export interface SessionSearchHit {
  conversationId: string;
  title: string;
  matches: SessionSearchMatch[];
}

export interface SessionExportPayload {
  meta: SessionMeta;
  body: ConversationState;
}

export interface SessionsIndex {
  version: 1;
  activeId: string;
  order: string[];
  sessions: Record<string, SessionMeta>;
  // Identifies the workspace this index belongs to. Loaded indexes whose
  // fingerprint differs from the active workspace are discarded — guards
  // against cross-workspace bleed when storageUri was unavailable.
  workspaceFingerprint?: string;
}

export interface CommandInvocation {
  name: string;
  source?: string;
}

export interface CommandCatalogueEntry {
  name: string;
  description?: string;
  argumentHint?: string;
  body: string;
  source: string;
}

export type WebviewToHost =
  | { type: "ready" }
  | { type: "submit"; prompt: string; modeId?: string; references?: ReferenceAttachment[]; seedTodos?: { title?: string; items: TodoItem[] }; command?: CommandInvocation; maxTurns?: number }
  | { type: "cancel" }
  | { type: "pickReferences"; existing?: ReferenceAttachment[] }
  | { type: "referenceSearch"; requestId: string; query: string; existing?: ReferenceAttachment[] }
  | { type: "newConversation" }
  | { type: "switchSession"; conversationId: string }
  | { type: "archiveSession"; conversationId: string }
  | { type: "unarchiveSession"; conversationId: string }
  | { type: "togglePinSession"; conversationId: string }
  | { type: "renameSession"; conversationId: string; title: string }
  | { type: "deleteSession"; conversationId: string }
  | { type: "setLlmConfig"; config: Omit<LlmConfigView, "hasApiKey"> }
  | { type: "setSecret"; provider: Exclude<LlmProvider, "local">; apiKey: string }
  | { type: "completeFirstRun" }
  | { type: "approve"; callId: CallId; approved: boolean; rememberRule?: AlwaysAllowRule; sessionCount?: number; autoApproveCategory?: AutoApproveCategory }
  | { type: "answerQuestions"; callId: CallId; answers: QuestionAnswer[] }
  | { type: "setAutoApprove"; config: AutoApproveConfig }
  | { type: "removeAlwaysAllowRule"; id: string }
  | { type: "requestAlwaysAllowList" }
  | { type: "subagentCancel"; subTaskId: string }
  | { type: "setMode"; modeId: string }
  | { type: "approveBatch"; batchId: string; decisions: Record<string, "approved" | "rejected"> }
  | { type: "processKill"; processId: string }
  | { type: "processOpenOutput"; processId: string }
  | { type: "processesClearCompleted" }
  | { type: "setWorkspaceFolder"; uri: string }
  | { type: "mcpReload" }
  | { type: "semanticQuerySubmit"; query: string; topK?: number }
  | { type: "sessionBranch"; conversationId: string; messageIndex: number; title?: string }
  | { type: "sessionExport"; conversationId: string; format: "json" | "markdown" }
  | { type: "sessionImport" }
  | { type: "sessionSearch"; query: string }
  | { type: "packSave"; name: string; refs: ReferenceAttachment[] }
  | { type: "packDelete"; id: string }
  | { type: "packRename"; id: string; name: string }
  | { type: "packApply"; id: string; mode?: "merge" | "replace" }
  | { type: "openInEditor"; id: string; title: string; content: string; language?: string };

export type HostToWebview =
  | { type: "delta"; text: string }
  | { type: "progress"; text: string; phase: ProgressPhase; createdAt: number }
  | { type: "toolCall"; call: ToolCall }
  | { type: "todoUpdate"; taskId: string; title?: string; items: TodoItem[] }
  | { type: "diffPreview"; callId: CallId; relPath: string; unified: string }
  | { type: "toolProgress"; callId: CallId; chunk: string }
  | { type: "toolResult"; callId: CallId; ok: boolean; summary: string; durationMs: number }
  | { type: "questionRequest"; callId: CallId; request: AskQuestionsInput }
  | { type: "questionAnswered"; callId: CallId; answers: QuestionAnswer[] }
  | { type: "subagentSpawn"; parentTaskId: string; subTaskId: string; subagentType: string; task: string }
  | { type: "subagentDelta"; subTaskId: string; text: string }
  | { type: "subagentToolCall"; subTaskId: string; call: ToolCall }
  | { type: "subagentToolProgress"; subTaskId: string; callId: CallId; chunk: string }
  | { type: "subagentToolResult"; subTaskId: string; callId: CallId; ok: boolean; summary: string; durationMs: number }
  | {
    type: "subagentDone";
    subTaskId: string;
    status: "completed" | "cancelled" | "error";
    summary: string;
    toolCalls: number;
    tokensUsed: number;
    inputTokens: number;
    outputTokens: number;
    truncated?: boolean;
  }
  | { type: "done"; taskId?: string; reason: TaskDone["reason"]; error?: string; durationMs?: number; maxTurns?: number }
  | { type: "restore"; messages: Msg[]; conversationId: string; usage: ConversationUsage; llmConfig: LlmConfigView }
  | { type: "llmConfig"; llmConfig: LlmConfigView }
  | { type: "firstRunState"; state: FirstRunState }
  | { type: "autoApprove"; config: AutoApproveConfig }
  | { type: "alwaysAllowList"; rules: AlwaysAllowRule[] }
  | { type: "usage"; usage: ConversationUsage }
  | { type: "mcpStatus"; status: McpServerStatus }
  | { type: "indexStatus"; status: IndexStatusNotify }
  | { type: "approvalBatchRequest"; batchId: string; items: ToolApprovalItem[] }
  | { type: "processesSnapshot"; processes: ProcessSnapshot[] }
  | { type: "referencePacks"; index: ReferencePacksIndex }
  | { type: "commandsCatalogue"; commands: CommandCatalogueEntry[] }
  | { type: "sessions"; index: SessionsIndex }
  | { type: "sessionSearchResults"; query: string; hits: SessionSearchHit[] }
  | { type: "workspaceFolders"; folders: Array<{ uri: string; name: string }>; activeUri: string }
  | { type: "summarized"; droppedCount: number }
  | { type: "planReady"; markdown?: string }
  | { type: "referencesPicked"; references: ReferenceAttachment[] }
  | { type: "referenceSuggestions"; requestId: string; query: string; suggestions: ReferenceAttachment[] }
  | { type: "referencePickError"; error: string }
  | { type: "error"; error: string }
  | { type: "modes"; modes: ModeDefinition[]; currentModeId: string }
  | { type: "modeAutoChanged"; modeId: string; label: string; prompt?: string }
  | { type: "themeConfig"; accent: string; density: string; themeBias: string };
