import * as path from "node:path";
import * as fs from "node:fs";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { JsonRpc } from "./rpc";
import type {
  TaskStartParams,
  MessageDelta,
  ToolCall,
  ToolResult,
  TaskDone,
  TaskUsage,
  ConversationUpdated,
  LlmMessage,
} from "./shared/protocol";

export interface AgentEvents {
  onDelta: (d: MessageDelta) => void;
  onToolStart: (c: ToolCall) => void;
  onToolResult: (r: ToolResult) => void;
  onToolCall: (c: ToolCall) => Promise<ToolResult>;
  onDone: (d: TaskDone) => void;
  onUsage: (u: TaskUsage) => void;
  onConversationUpdated: (u: ConversationUpdated) => void;
  onSummarized: (s: { taskId: string; conversationId: string; droppedCount: number }) => void;
  onError: (err: string) => void;
}

export type LlmProvider = "openai" | "anthropic";

export interface LlmConfig {
  provider: LlmProvider;
  openai?: {
    apiKey: string;
    baseUrl?: string;
    model: string;
    reasoningEffort?: "" | "low" | "medium" | "high";
  };
  anthropic?: {
    apiKey: string;
    model: string;
  };
}

export class AgentClient {
  private proc?: ChildProcessWithoutNullStreams;
  private rpc?: JsonRpc;
  private activeTaskId?: string;

  constructor(
    private readonly extensionPath: string,
    private readonly events: AgentEvents
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
      env: { ...process.env, ...buildSpawnEnv(cfg) },
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

function buildSpawnEnv(cfg: LlmConfig): Record<string, string> {
  const env: Record<string, string> = {
    MY_AGENT_PROVIDER: cfg.provider,
  };
  if (cfg.provider === "openai" && cfg.openai) {
    env.OPENAI_API_KEY = cfg.openai.apiKey;
    env.OPENAI_MODEL = cfg.openai.model;
    if (cfg.openai.baseUrl) env.OPENAI_BASE_URL = cfg.openai.baseUrl;
    if (cfg.openai.reasoningEffort) env.OPENAI_REASONING_EFFORT = cfg.openai.reasoningEffort;
  } else if (cfg.provider === "anthropic" && cfg.anthropic) {
    env.ANTHROPIC_API_KEY = cfg.anthropic.apiKey;
    env.MY_AGENT_MODEL = cfg.anthropic.model;
  }
  return env;
}
