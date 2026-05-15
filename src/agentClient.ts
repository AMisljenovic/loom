import * as path from "node:path";
import * as fs from "node:fs";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { JsonRpc } from "./rpc";
import type {
  ConfigUpdateParams,
  ConfigUpdateResult,
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
  onError: (err: string) => void;
}

export type LlmConfig =
  | {
    provider: "openai";
    openai: {
      apiKey: string;
      baseUrl?: string;
      model: string;
      reasoningEffort?: ReasoningEffort;
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
}

export class AgentClient {
  private proc?: ChildProcessWithoutNullStreams;
  private rpc?: JsonRpc;
  private activeTaskId?: string;

  constructor(
    private readonly extensionPath: string,
    private readonly events: AgentEvents,
    private readonly extras: AgentSpawnExtras = {},
  ) {}

  async start(cfg: LlmConfig) {
    const binary = this.binaryPath();
    if (!fs.existsSync(binary)) {
      throw new Error(`Agent binary not found at ${binary}. Run \`npm run build:agent\`.`);
    }
    if (process.platform !== "win32") {
      try { fs.chmodSync(binary, 0o755); } catch { /* ignore */ }
    }

    this.proc = spawn(binary, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...buildSpawnEnv(cfg), ...buildExtrasEnv(this.extras) },
    });
    this.proc.stderr.on("data", (d) => console.error("[agent]", d.toString()));
    this.proc.on("exit", (code) => {
      this.events.onError(`agent exited with code ${code}`);
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

  dispose() {
    this.proc?.kill();
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
  return env;
}

function buildSpawnEnv(cfg: LlmConfig): Record<string, string> {
  const agentCfg = toAgentConfig(cfg);
  const env: Record<string, string> = {
    MY_AGENT_PROVIDER: agentCfg.provider,
  };
  if (agentCfg.provider === "openai") {
    env.OPENAI_API_KEY = agentCfg.apiKey;
    env.OPENAI_MODEL = agentCfg.model;
    if (agentCfg.baseUrl) env.OPENAI_BASE_URL = agentCfg.baseUrl;
    if (agentCfg.reasoningEffort) env.OPENAI_REASONING_EFFORT = agentCfg.reasoningEffort;
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
    };
  }
  if (cfg.provider === "openai") {
    return {
      provider: "openai",
      apiKey: cfg.openai.apiKey,
      model: cfg.openai.model,
      baseUrl: cfg.openai.baseUrl,
      reasoningEffort: cfg.openai.reasoningEffort,
    };
  }
  return {
    provider: "anthropic",
    apiKey: cfg.anthropic.apiKey,
    model: cfg.anthropic.model,
  };
}
