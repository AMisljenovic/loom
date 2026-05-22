import * as path from "node:path";
import * as fs from "node:fs";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { JsonRpc } from "./rpc";
import type {
  ConfigUpdateParams,
  ConfigUpdateResult,
  CustomHeader,
  IndexStatusNotify,
  McpConfig,
  McpConfigureResult,
  McpServerStatus,
  TaskStartParams,
  MessageDelta,
  ToolCall,
  ToolApprovalResult,
  ToolApproveBatchParams,
  ToolApproveBatchResult,
  ToolResult,
  TaskDone,
  TaskUsage,
  ConversationUpdated,
  LlmMessage,
  ReasoningEffort,
  SubAgentDone,
  SubAgentSpawn,
} from "./shared/protocol";

export interface AgentEvents {
  onDelta: (d: MessageDelta) => void;
  onToolStart: (c: ToolCall) => void;
  onToolResult: (r: ToolResult) => void;
  onToolCall: (c: ToolCall) => Promise<ToolResult>;
  onToolApprove: (c: ToolCall) => Promise<ToolApprovalResult>;
  onToolApproveBatch: (params: ToolApproveBatchParams) => Promise<ToolApproveBatchResult>;
  onMcpStatus: (s: McpServerStatus) => void;
  onDone: (d: TaskDone) => void;
  onUsage: (u: TaskUsage) => void;
  onConversationUpdated: (u: ConversationUpdated) => void;
  onSummarized: (s: { taskId: string; conversationId: string; droppedCount: number }) => void;
  onIndexStatus: (s: IndexStatusNotify) => void;
  onSubAgentSpawn: (s: SubAgentSpawn) => void;
  onSubAgentDone: (s: SubAgentDone) => void;
  onError: (err: string) => void;
  onLog?: (line: string) => void;
}

export interface AdvancedOpts {
  maxOutputTokens?: number;
  contextWindow?: number;
  customHeaders?: CustomHeader[];
  useResponsesAPI?: boolean;
}

export type LlmConfig =
  | {
    provider: "openai";
    openai: {
      apiKey: string;
      baseUrl?: string;
      model: string;
      reasoningEffort?: ReasoningEffort;
      advanced?: AdvancedOpts;
    };
  }
  | {
    provider: "openai-compatible";
    openaiCompatible: {
      apiKey: string;
      baseUrl: string;
      model: string;
      reasoningEffort?: ReasoningEffort;
      advanced?: AdvancedOpts;
    };
  }
  | {
    provider: "anthropic";
    anthropic: {
      apiKey: string;
      model: string;
    };
  }
  | {
    provider: "local";
    local: {
      baseUrl: string;
      model: string;
      advanced?: AdvancedOpts;
    };
  };

export interface AgentSpawnExtras {
  telemetry?: {
    enabled: boolean;
    endpoint?: string;
    machineIdHash?: string;
  };
  embeddings?: {
    provider: "disabled" | "ollama" | "voyage";
    model?: string;
    voyageApiKey?: string;
    ollamaHost?: string;
  };
  // storageDir, when present, is forwarded to the agent as LOOM_STORAGE_DIR.
  // The Go side writes the per-conversation scratchpad and the vector-index
  // SQLite database under that directory instead of <workspace>/.loom/, so
  // runtime artifacts stay out of the repo.
  storageDir?: string;
}

export class AgentClient {
  private proc?: ChildProcessWithoutNullStreams;
  private rpc?: JsonRpc;
  private activeTaskId?: string;
  private disposed = false;

  constructor(
    private readonly extensionPath: string,
    private readonly events: AgentEvents,
    private readonly extras: AgentSpawnExtras = {},
  ) {}

  async start(cfg: LlmConfig) {
    const binary = this.binaryPath();
    const agentCfg = toAgentConfig(cfg);
    if (!fs.existsSync(binary)) {
      throw new Error(`Agent binary not found at ${binary}. Run \`npm run build:agent\`.`);
    }
    if (process.platform !== "win32") {
      try { fs.chmodSync(binary, 0o755); } catch { /* ignore */ }
    }

    this.disposed = false;
    this.events.onLog?.(`[agent] spawning ${binary} provider=${agentCfg.provider} model=${agentCfg.model} baseUrl=${agentCfg.baseUrl || "<default>"}`);
    this.proc = spawn(binary, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...buildSpawnEnv(cfg), ...buildExtrasEnv(this.extras) },
    });
    this.proc.stderr.on("data", (d) => this.events.onLog?.(`[agent] ${d.toString()}`));
    this.proc.on("exit", (code) => {
      if (!this.disposed) {
        this.events.onError(`agent exited with code ${code}`);
      }
    });

    this.rpc = new JsonRpc(this.proc.stdout, this.proc.stdin);
    this.rpc.onRequest("tool.call", async (params: ToolCall) => {
      const result = await this.events.onToolCall(params);
      return result;
    });
    this.rpc.onRequest("tool.approve", async (params: ToolCall) => {
      return this.events.onToolApprove(params);
    });
    this.rpc.onRequest("tool.approveBatch", async (params: ToolApproveBatchParams) => {
      return this.events.onToolApproveBatch(params);
    });
    this.rpc.onRequest("tool.localCall", (params: ToolCall) => {
      this.events.onToolStart(params);
    });
    this.rpc.onRequest("tool.localResult", (params: ToolResult) => {
      this.events.onToolResult(params);
    });
    this.rpc.onRequest("message.delta", (params: MessageDelta) => {
      this.events.onDelta(params);
    });
    this.rpc.onRequest("task.done", (params: TaskDone) => {
      if (this.activeTaskId === params.taskId) {
        this.activeTaskId = undefined;
      }
      this.events.onDone(params);
    });
    this.rpc.onRequest("task.usage", (params: TaskUsage) => {
      this.events.onUsage(params);
    });
    this.rpc.onRequest("conversation.updated", (params: ConversationUpdated) => {
      this.events.onConversationUpdated(params);
    });
    this.rpc.onRequest("task.summarized", (params: { taskId: string; conversationId: string; droppedCount: number }) => {
      this.events.onSummarized(params);
    });
    this.rpc.onRequest("subagent.spawn", (params: SubAgentSpawn) => {
      this.events.onSubAgentSpawn(params);
    });
    this.rpc.onRequest("subagent.done", (params: SubAgentDone) => {
      this.events.onSubAgentDone(params);
    });
    this.rpc.onRequest("mcp.serverStatus", (params: McpServerStatus) => {
      this.events.onMcpStatus(params);
    });
    this.rpc.onRequest("index.status", (params: IndexStatusNotify) => {
      this.events.onIndexStatus(params);
    });
  }

  async invalidateIndex(paths: string[]): Promise<void> {
    if (!this.rpc || paths.length === 0) return;
    await this.rpc.request("index.invalidate", { paths });
  }

  async startTask(params: TaskStartParams) {
    if (!this.rpc) throw new Error("agent not started");
    this.activeTaskId = params.taskId;
    return this.rpc.request("task.start", params);
  }

  async cancel(taskId = this.activeTaskId) {
    if (!this.rpc || !taskId) return;
    return this.rpc.request("task.cancel", { taskId });
  }

  async hydrateConversation(params: {
    conversationId: string;
    messages: LlmMessage[];
    cumulativeInput: number;
    cumulativeOutput: number;
    lastInputTokens?: number;
    lastOutputTokens?: number;
  }) {
    if (!this.rpc) throw new Error("agent not started");
    return this.rpc.request("conversation.hydrate", {
      ...params,
      lastInputTokens: params.lastInputTokens ?? 0,
      lastOutputTokens: params.lastOutputTokens ?? 0,
    });
  }

  async resetConversation(conversationId: string) {
    if (!this.rpc) return;
    return this.rpc.request("conversation.reset", { conversationId });
  }

  async updateConfig(cfg: LlmConfig): Promise<void> {
    if (!this.rpc) throw new Error("agent not started");
    const result = await this.rpc.request<ConfigUpdateResult>("config.update", toAgentConfig(cfg));
    if (!result.ok) {
      throw new Error(result.error);
    }
  }

  async configureMcp(cfg: McpConfig): Promise<void> {
    if (!this.rpc) throw new Error("agent not started");
    const result = await this.rpc.request<McpConfigureResult>("mcp.configure", cfg);
    if (!result.ok) {
      throw new Error(result.error);
    }
  }

  async dispose() {
    this.disposed = true;
    await Promise.race([
      this.cancel().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]);
    this.proc?.kill();
    this.proc = undefined;
    this.rpc = undefined;
    this.activeTaskId = undefined;
  }

  private binaryPath(): string {
    const platform = process.platform;
    const arch = process.arch;
    const ext = platform === "win32" ? ".exe" : "";
    return path.join(this.extensionPath, "bin", `agent-${platform}-${arch}${ext}`);
  }
}

function buildExtrasEnv(extras: AgentSpawnExtras): Record<string, string> {
  const env: Record<string, string> = {};
  if (extras.telemetry?.enabled) {
    env.LOOM_TELEMETRY_ENABLED = "1";
    if (extras.telemetry.endpoint) {
      env.LOOM_TELEMETRY_ENDPOINT = extras.telemetry.endpoint;
    }
    if (extras.telemetry.machineIdHash) {
      env.LOOM_TELEMETRY_MACHINE_ID = extras.telemetry.machineIdHash;
    }
  }
  const embed = extras.embeddings;
  if (embed && embed.provider !== "disabled") {
    env.LOOM_EMBED_PROVIDER = embed.provider;
    if (embed.model) {
      env.LOOM_EMBED_MODEL = embed.model;
    }
    if (embed.voyageApiKey) {
      env.VOYAGE_API_KEY = embed.voyageApiKey;
    }
    if (embed.ollamaHost) {
      env.OLLAMA_HOST = embed.ollamaHost;
    }
  }
  if (extras.storageDir && extras.storageDir.trim()) {
    env.LOOM_STORAGE_DIR = extras.storageDir;
  }
  return env;
}

function buildSpawnEnv(cfg: LlmConfig): Record<string, string> {
  const agentCfg = toAgentConfig(cfg);
  const env: Record<string, string> = {
    MY_AGENT_PROVIDER: agentCfg.provider,
    ANTHROPIC_API_KEY: "",
    MY_AGENT_MODEL: "",
    OPENAI_API_KEY: "",
    OPENAI_MODEL: "",
    OPENAI_BASE_URL: "",
    OPENAI_REASONING_EFFORT: "",
    OPENAI_MAX_OUTPUT_TOKENS: "",
    OPENAI_CONTEXT_WINDOW: "",
    OPENAI_CUSTOM_HEADERS: "",
    OPENAI_USE_RESPONSES: "",
  };
  if (agentCfg.provider === "openai") {
    env.OPENAI_API_KEY = agentCfg.apiKey;
    env.OPENAI_MODEL = agentCfg.model;
    env.OPENAI_BASE_URL = agentCfg.baseUrl ?? "";
    env.OPENAI_REASONING_EFFORT = agentCfg.reasoningEffort ?? "";
    if (typeof agentCfg.maxOutputTokens === "number" && agentCfg.maxOutputTokens > 0) {
      env.OPENAI_MAX_OUTPUT_TOKENS = String(agentCfg.maxOutputTokens);
    }
    if (typeof agentCfg.contextWindow === "number" && agentCfg.contextWindow > 0) {
      env.OPENAI_CONTEXT_WINDOW = String(agentCfg.contextWindow);
    }
    if (agentCfg.customHeaders && agentCfg.customHeaders.length > 0) {
      env.OPENAI_CUSTOM_HEADERS = JSON.stringify(agentCfg.customHeaders);
    }
    if (agentCfg.useResponsesAPI === true) {
      env.OPENAI_USE_RESPONSES = "1";
    }
  } else {
    env.ANTHROPIC_API_KEY = agentCfg.apiKey;
    env.MY_AGENT_MODEL = agentCfg.model;
  }
  return env;
}

function toAgentConfig(cfg: LlmConfig): ConfigUpdateParams {
  if (cfg.provider === "local") {
    return {
      provider: "openai",
      apiKey: "local",
      model: cfg.local.model,
      baseUrl: cfg.local.baseUrl,
      ...advancedToParams(cfg.local.advanced),
    };
  }
  if (cfg.provider === "openai") {
    return {
      provider: "openai",
      apiKey: cfg.openai.apiKey,
      model: cfg.openai.model,
      baseUrl: cfg.openai.baseUrl,
      reasoningEffort: cfg.openai.reasoningEffort,
      ...advancedToParams(cfg.openai.advanced),
    };
  }
  if (cfg.provider === "openai-compatible") {
    return {
      provider: "openai",
      apiKey: cfg.openaiCompatible.apiKey,
      model: cfg.openaiCompatible.model,
      baseUrl: cfg.openaiCompatible.baseUrl,
      reasoningEffort: cfg.openaiCompatible.reasoningEffort,
      ...advancedToParams(cfg.openaiCompatible.advanced),
    };
  }
  return {
    provider: "anthropic",
    apiKey: cfg.anthropic.apiKey,
    model: cfg.anthropic.model,
  };
}

function advancedToParams(advanced: AdvancedOpts | undefined): Partial<ConfigUpdateParams> {
  if (!advanced) return {};
  const out: Partial<ConfigUpdateParams> = {};
  if (typeof advanced.maxOutputTokens === "number" && advanced.maxOutputTokens > 0) {
    out.maxOutputTokens = advanced.maxOutputTokens;
  }
  if (typeof advanced.contextWindow === "number" && advanced.contextWindow > 0) {
    out.contextWindow = advanced.contextWindow;
  }
  if (advanced.customHeaders && advanced.customHeaders.length > 0) {
    out.customHeaders = advanced.customHeaders.filter((h) => h.name.trim() !== "");
  }
  if (advanced.useResponsesAPI === true) {
    out.useResponsesAPI = true;
  }
  return out;
}
