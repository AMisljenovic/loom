import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { AgentClient, LlmConfig } from "../agentClient";
import { consumeHostApprovalPolicy } from "../approval/hostPolicy";
import { loadDotEnv } from "../env";
import { resolveMcpConfig } from "../mcpConfig";
import { BUILTIN_MODES, mergeModes } from "../modes";
import { secretKeyFor } from "../secrets";
import type {
  AlwaysAllowRule,
  ConversationState,
  ConversationUpdated,
  HostToWebview,
  LlmConfigView,
  LlmProvider,
  McpConfig,
  McpServerStatus,
  ModeDefinition,
  Msg,
  ReasoningEffort,
  TaskDone,
  TaskUsage,
  ToolCall,
  ToolResult,
  WebviewToHost,
} from "../shared/protocol";
import {
  cachePreparedApplyDiff,
  discardPreparedApplyDiff,
  executeTool,
  prepareApplyDiff,
} from "../tools";
import {
  clearDiffPreview,
  closeDiffPreview,
  openDiffPreview,
  setDiffPreview,
} from "../tools/diffPreview";
import { createUnifiedDiff } from "../tools/unifiedDiff";

const STATE_KEY = "loom.conversation";
const AUTO_APPROVE_KEY = "loom.autoApprove";
const ALWAYS_ALLOW_KEY = "loom.alwaysAllow";
const MODE_KEY = "loom.currentMode";
const LOCAL_BASE_URL = "http://localhost:11434/v1";
const LOCAL_MODEL = "llama3.1";
const ANTHROPIC_MODEL = "claude-opus-4-7";
const OPENAI_MODEL = "gpt-5";

export class ChatPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = "loom.chat";

  private view?: vscode.WebviewView;
  private agent?: AgentClient;
  private pendingApprovals = new Map<string, (ok: boolean) => void>();
  private pendingApprovalCalls = new Map<string, ToolCall>();
  private toolStartTimes = new Map<string, number>();
  private state: ConversationState;
  private autoApprove = false;
  private alwaysAllow: AlwaysAllowRule[] = [];
  private currentModeId: string = "code";
  private sessionBulkCounters = new Map<string, number>();
  private persistTimer?: NodeJS.Timeout;
  private activeTaskId?: string;
  private busy = false;
  private queuedPrompt?: string;
  private assistantIndex: number | null = null;
  private hydratedConversationId?: string;
  private webviewMessageQueue: Promise<void> = Promise.resolve();

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.state = this.loadState();
    this.autoApprove = this.ctx.workspaceState.get<boolean>(AUTO_APPROVE_KEY, false);
    this.alwaysAllow = this.loadAlwaysAllow();
    this.currentModeId = this.ctx.workspaceState.get<string>(MODE_KEY) ?? "code";
    this.ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("loom.mcp")) {
        this.configureMcpSoon();
      }
    }));
    const watcher = vscode.workspace.createFileSystemWatcher("**/.vscode/mcp.json");
    watcher.onDidCreate(() => this.configureMcpSoon(), this, this.ctx.subscriptions);
    watcher.onDidChange(() => this.configureMcpSoon(), this, this.ctx.subscriptions);
    watcher.onDidDelete(() => this.configureMcpSoon(), this, this.ctx.subscriptions);
    this.ctx.subscriptions.push(watcher);
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "dist", "webview")],
    };
    view.webview.html = this.getHtml(view.webview);
    view.webview.onDidReceiveMessage((m: WebviewToHost) => {
      this.webviewMessageQueue = this.webviewMessageQueue
        .then(() => this.onWebviewMessage(m))
        .catch((e: unknown) => this.post({ type: "error", error: e instanceof Error ? e.message : String(e) }));
    });
  }

  private post(msg: HostToWebview, mirror = true) {
    if (mirror) {
      this.mirrorHostMessage(msg);
    }
    this.view?.webview.postMessage(msg);
  }

  private async onWebviewMessage(m: WebviewToHost) {
    if (m.type === "ready") {
      await this.restoreWebview();
    } else if (m.type === "submit") {
      if (this.busy) {
        this.queuedPrompt = m.prompt;
        if (this.activeTaskId) {
          await this.agent?.cancel(this.activeTaskId);
        }
        return;
      }
      await this.runTask(m.prompt);
    } else if (m.type === "cancel") {
      if (this.activeTaskId) {
        await this.agent?.cancel(this.activeTaskId);
      }
    } else if (m.type === "newConversation") {
      await this.newConversation();
    } else if (m.type === "setSecret") {
      if (m.apiKey.trim()) {
        await this.ctx.secrets.store(secretKeyFor(m.provider), m.apiKey.trim());
      }
      await this.postLlmConfig();
    } else if (m.type === "setLlmConfig") {
      await this.applyLlmConfig(m.config);
    } else if (m.type === "approve") {
      const call = this.pendingApprovalCalls.get(m.callId);
      if (m.approved) {
        if (m.rememberRule) {
          this.addAlwaysAllowRule(m.rememberRule);
        }
        if (call && typeof m.sessionCount === "number" && m.sessionCount > 0) {
          this.sessionBulkCounters.set(call.name, Math.floor(m.sessionCount));
        }
      }
      this.pendingApprovals.get(m.callId)?.(m.approved);
      this.pendingApprovals.delete(m.callId);
      this.pendingApprovalCalls.delete(m.callId);
    } else if (m.type === "setAutoApprove") {
      this.autoApprove = m.enabled;
      this.schedulePersist();
      this.postAutoApprove();
    } else if (m.type === "removeAlwaysAllowRule") {
      this.alwaysAllow = this.alwaysAllow.filter((rule) => rule.id !== m.id);
      this.schedulePersist();
      this.postAlwaysAllowList();
    } else if (m.type === "requestAlwaysAllowList") {
      this.postAlwaysAllowList();
    } else if (m.type === "setMode") {
      this.currentModeId = m.modeId;
      this.schedulePersist();
      this.postModes();
    }
  }

  private async runTask(prompt: string) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    if (!(await this.ensureAgent(workspaceRoot))) {
      return;
    }

    const taskId = randomUUID();
    this.activeTaskId = taskId;
    this.busy = true;
    this.state.messages.push({ role: "user", text: prompt });
    this.assistantIndex = null;
    this.schedulePersist();

    try {
      const modes = this.getModes();
      const activeMode = modes.find((m) => m.id === this.currentModeId);
      await this.agent?.startTask({
        taskId,
        conversationId: this.state.conversationId,
        prompt,
        workspaceRoot,
        cwd: workspaceRoot,
        mode: activeMode,
      });
    } catch (e: unknown) {
      this.activeTaskId = undefined;
      this.busy = false;
      this.post({ type: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async ensureAgent(workspaceRoot: string): Promise<boolean> {
    if (!this.agent) {
      const cfg = await this.resolveLlmConfig(workspaceRoot, this.ctx.extensionPath);
      if ("error" in cfg) {
        this.post({ type: "error", error: cfg.error });
        return false;
      }
      this.agent = this.createAgent(workspaceRoot);
      await this.agent.start(cfg);
    }
    await this.configureMcp();

    if (this.hydratedConversationId !== this.state.conversationId) {
      await this.agent.hydrateConversation({
        conversationId: this.state.conversationId,
        messages: this.state.llmMessages,
        cumulativeInput: this.state.usage.inputTokens,
        cumulativeOutput: this.state.usage.outputTokens,
        lastInputTokens: this.state.lastInputTokens,
        lastOutputTokens: this.state.lastOutputTokens,
      });
      this.hydratedConversationId = this.state.conversationId;
    }

    return true;
  }

  private createAgent(workspaceRoot: string): AgentClient {
    return new AgentClient(this.ctx.extensionPath, {
      onDelta: ({ text }) => this.post({ type: "delta", text }),
      onToolStart: (call: ToolCall) => {
        this.toolStartTimes.set(call.callId, Date.now());
        this.post({ type: "toolCall", call });
      },
      onToolResult: (result: ToolResult) => {
        const measured = this.finishToolTiming(result.callId);
        const durationMs = result.durationMs ?? measured;
        this.post({
          type: "toolResult",
          callId: result.callId,
          ok: result.ok,
          summary: result.content ?? result.error ?? "",
          durationMs,
        });
      },
      onToolCall: async (call: ToolCall) => {
        this.toolStartTimes.set(call.callId, Date.now());
        if (call.requiresApproval) {
          if (this.isApprovedByHostPolicy(call)) {
            this.post({ type: "toolCall", call: { ...call, requiresApproval: false } });
          } else {
            if (call.name === "apply_diff") {
              try {
                const plan = await prepareApplyDiff(call, { workspaceRoot });
                cachePreparedApplyDiff(plan);
                setDiffPreview(call.callId, plan.relPath, plan.before, plan.after);
                await openDiffPreview(call.callId, plan.relPath);
                this.post({
                  type: "diffPreview",
                  callId: call.callId,
                  relPath: plan.relPath,
                  unified: createUnifiedDiff(plan.relPath, plan.before, plan.after),
                });
              } catch (e: unknown) {
                const result = this.failedToolResult(call.callId, e);
                this.post({ type: "toolCall", call });
                this.post({
                  type: "toolResult",
                  callId: call.callId,
                  ok: false,
                  summary: result.error ?? "",
                  durationMs: this.finishToolTiming(call.callId),
                });
                return result;
              }
            }
            this.post({ type: "toolCall", call });
            const approved = await new Promise<boolean>((resolve) => {
              this.pendingApprovals.set(call.callId, resolve);
              this.pendingApprovalCalls.set(call.callId, call);
            });
            if (!approved) {
              await this.cleanupApplyDiff(call.callId);
              this.post({
                type: "toolResult",
                callId: call.callId,
                ok: false,
                summary: "rejected",
                durationMs: this.finishToolTiming(call.callId),
              });
              return { callId: call.callId, ok: false, error: "user rejected" };
            }
          }
        } else {
          this.post({ type: "toolCall", call });
        }
        try {
          const result = await executeTool(call, async () => true, {
            workspaceRoot,
            onProgress: (chunk) => this.post({ type: "toolProgress", callId: call.callId, chunk }),
          });
          this.post({
            type: "toolResult",
            callId: call.callId,
            ok: result.ok,
            summary: result.content ?? result.error ?? "",
            durationMs: this.finishToolTiming(call.callId),
          });
          return result;
        } finally {
          if (call.name === "apply_diff") {
            await this.cleanupApplyDiff(call.callId);
          }
        }
      },
      onToolApprove: async (call: ToolCall) => this.approveLocalTool(call),
      onMcpStatus: (status) => this.handleMcpStatus(status),
      onDone: (done) => this.handleDone(done),
      onUsage: (usage) => this.handleUsage(usage),
      onConversationUpdated: (update) => this.handleConversationUpdated(update),
      onSummarized: ({ droppedCount }) => this.post({ type: "summarized", droppedCount }),
      onError: (error) => this.post({ type: "error", error }),
    });
  }

  private async handleDone({ taskId, reason }: TaskDone) {
    this.post({ type: "done", reason });
    if (this.activeTaskId === taskId) {
      this.activeTaskId = undefined;
    }
    this.busy = false;

    const next = this.queuedPrompt;
    this.queuedPrompt = undefined;
    if (next && reason === "cancelled") {
      await this.runTask(next);
    }
  }

  private handleUsage(usage: TaskUsage) {
    this.post({
      type: "usage",
      usage: {
        inputTokens: usage.cumulativeInput,
        outputTokens: usage.cumulativeOutput,
        model: usage.model,
      },
    });
  }

  private handleConversationUpdated(update: ConversationUpdated) {
    if (update.conversationId !== this.state.conversationId) {
      return;
    }
    this.state.llmMessages = update.messages;
    this.state.usage = {
      inputTokens: update.cumulativeInput,
      outputTokens: update.cumulativeOutput,
      model: update.model,
    };
    this.state.lastInputTokens = update.lastInputTokens;
    this.state.lastOutputTokens = update.lastOutputTokens;
    this.schedulePersist();
    void this.postLlmConfig();
  }

  private async newConversation() {
    if (this.busy) {
      return;
    }
    const oldConversationId = this.state.conversationId;
    await this.agent?.resetConversation(oldConversationId);
    this.state = this.emptyState();
    this.hydratedConversationId = undefined;
    this.assistantIndex = null;
    this.pendingApprovals.clear();
    this.pendingApprovalCalls.clear();
    this.sessionBulkCounters.clear();
    this.toolStartTimes.clear();
    this.persistNow();
    await this.restoreWebview();
  }

  private async restoreWebview() {
    this.post({
      type: "restore",
      messages: this.state.messages,
      conversationId: this.state.conversationId,
      usage: this.state.usage,
      llmConfig: await this.currentLlmConfigView(),
    }, false);
    this.postAutoApprove();
    this.postAlwaysAllowList();
    this.postModes();
  }

  private mirrorHostMessage(msg: HostToWebview) {
    if (msg.type === "delta") {
      if (this.assistantIndex === null || this.state.messages[this.assistantIndex]?.role !== "assistant") {
        this.state.messages.push({ role: "assistant", text: msg.text });
        this.assistantIndex = this.state.messages.length - 1;
      } else {
        const cur = this.state.messages[this.assistantIndex] as Extract<Msg, { role: "assistant" }>;
        this.state.messages[this.assistantIndex] = { ...cur, text: cur.text + msg.text };
      }
      this.schedulePersist();
    } else if (msg.type === "toolCall") {
      this.state.messages.push({
        role: "tool",
        name: msg.call.name,
        status: msg.call.requiresApproval ? "pending" : "approved",
        callId: msg.call.callId,
        input: msg.call.input,
        expanded: false,
      });
      this.schedulePersist();
    } else if (msg.type === "toolProgress") {
      updateTool(this.state.messages, msg.callId, (tool) => ({
        ...tool,
        status: tool.status === "approved" ? "running" : tool.status,
        output: `${tool.output ?? ""}${msg.chunk}`,
        expanded: tool.expanded ?? true,
      }));
      this.schedulePersist();
    } else if (msg.type === "toolResult") {
      updateTool(this.state.messages, msg.callId, (tool) => {
        const hasOutput = Boolean(tool.output);
        const finalOutput = mergeToolOutput(tool.output, msg.summary);
        const status = !msg.ok && msg.summary === "rejected" ? "rejected" : msg.ok ? "done" : "error";
        return {
          ...tool,
          status,
          output: hasOutput ? finalOutput : msg.summary,
          durationMs: msg.durationMs,
        };
      });
      this.schedulePersist();
    } else if (msg.type === "done") {
      if (msg.reason === "cancelled" && this.assistantIndex !== null) {
        const cur = this.state.messages[this.assistantIndex];
        if (cur?.role === "assistant" && cur.text && !cur.text.endsWith(" [interrupted]")) {
          this.state.messages[this.assistantIndex] = { ...cur, text: `${cur.text} [interrupted]` };
        }
      }
      this.assistantIndex = null;
      this.schedulePersist();
    } else if (msg.type === "usage") {
      this.state.usage = msg.usage;
      this.schedulePersist();
    } else if (msg.type === "summarized") {
      this.state.messages.push({
        role: "assistant",
        text: `Context summarized (${msg.droppedCount} older messages compacted).`,
      });
      this.schedulePersist();
    } else if (msg.type === "error") {
      this.state.messages.push({ role: "assistant", text: `Error: ${msg.error}` });
      this.assistantIndex = null;
      this.schedulePersist();
    }
  }

  private loadState(): ConversationState {
    const saved = this.ctx.workspaceState.get<ConversationState>(STATE_KEY);
    if (saved?.conversationId && Array.isArray(saved.messages) && Array.isArray(saved.llmMessages)) {
      return {
        conversationId: saved.conversationId,
        messages: saved.messages,
        llmMessages: saved.llmMessages,
        usage: saved.usage ?? { inputTokens: 0, outputTokens: 0 },
        lastInputTokens: saved.lastInputTokens,
        lastOutputTokens: saved.lastOutputTokens,
      };
    }
    return this.emptyState();
  }

  private loadAlwaysAllow(): AlwaysAllowRule[] {
    const saved = this.ctx.workspaceState.get<AlwaysAllowRule[]>(ALWAYS_ALLOW_KEY, []);
    if (!Array.isArray(saved)) {
      return [];
    }
    return saved.flatMap((rule) => {
      const normalized = this.normalizeAlwaysAllowRule(rule);
      return normalized ? [normalized] : [];
    });
  }

  private emptyState(): ConversationState {
    return {
      conversationId: randomUUID(),
      messages: [],
      llmMessages: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  private schedulePersist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => this.persistNow(), 250);
  }

  private persistNow() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    void Promise.all([
      this.ctx.workspaceState.update(STATE_KEY, this.state),
      this.ctx.workspaceState.update(AUTO_APPROVE_KEY, this.autoApprove),
      this.ctx.workspaceState.update(ALWAYS_ALLOW_KEY, this.alwaysAllow),
      this.ctx.workspaceState.update(MODE_KEY, this.currentModeId),
    ]);
  }

  private isApprovedByHostPolicy(call: ToolCall): boolean {
    return consumeHostApprovalPolicy(call, {
      autoApprove: this.autoApprove,
      alwaysAllow: this.alwaysAllow,
      sessionBulkCounters: this.sessionBulkCounters,
    });
  }

  private addAlwaysAllowRule(rule: AlwaysAllowRule) {
    const normalized = this.normalizeAlwaysAllowRule(rule);
    if (!normalized) {
      return;
    }
    const exists = this.alwaysAllow.some((existing) => (
      existing.tool === normalized.tool &&
      existing.scope === normalized.scope &&
      existing.pattern === normalized.pattern &&
      existing.argKey === normalized.argKey
    ));
    if (!exists) {
      this.alwaysAllow = [...this.alwaysAllow, normalized];
      this.schedulePersist();
    }
    this.postAlwaysAllowList();
  }

  private normalizeAlwaysAllowRule(rule: AlwaysAllowRule): AlwaysAllowRule | undefined {
    if (!rule || typeof rule.tool !== "string" || !rule.tool) {
      return undefined;
    }
    if (rule.scope !== "tool" && rule.scope !== "argPattern") {
      return undefined;
    }
    if (rule.scope === "argPattern") {
      if (typeof rule.pattern !== "string" || !rule.pattern) {
        return undefined;
      }
      if (rule.argKey !== "command" && rule.argKey !== "path") {
        return undefined;
      }
    }
    return {
      id: typeof rule.id === "string" && rule.id ? rule.id : randomUUID(),
      tool: rule.tool,
      scope: rule.scope,
      pattern: rule.scope === "argPattern" ? rule.pattern : undefined,
      argKey: rule.scope === "argPattern" ? rule.argKey : undefined,
      createdAt: typeof rule.createdAt === "number" ? rule.createdAt : Date.now(),
    };
  }

  private postAutoApprove() {
    this.post({ type: "autoApprove", enabled: this.autoApprove }, false);
  }

  private postAlwaysAllowList() {
    this.post({ type: "alwaysAllowList", rules: this.alwaysAllow }, false);
  }

  private getModes(): ModeDefinition[] {
    const userModes = vscode.workspace.getConfiguration("loom").get<ModeDefinition[]>("modes", []);
    return mergeModes(BUILTIN_MODES, Array.isArray(userModes) ? userModes : []);
  }

  private postModes() {
    this.post({ type: "modes", modes: this.getModes(), currentModeId: this.currentModeId }, false);
  }

  private finishToolTiming(callId: string): number {
    const startedAt = this.toolStartTimes.get(callId);
    this.toolStartTimes.delete(callId);
    return startedAt ? Date.now() - startedAt : 0;
  }

  private failedToolResult(callId: string, e: unknown): ToolResult {
    return {
      callId,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  private async cleanupApplyDiff(callId: string) {
    discardPreparedApplyDiff(callId);
    clearDiffPreview(callId);
    await closeDiffPreview(callId);
  }

  private async applyLlmConfig(config: Omit<LlmConfigView, "hasApiKey">) {
    const provider = this.validProvider(config.provider) ? config.provider : "anthropic";
    const settings = vscode.workspace.getConfiguration("loom");
    const target = this.configurationTarget();
    await settings.update("provider", provider, target);
    if (provider === "anthropic") {
      await settings.update("model", config.model || ANTHROPIC_MODEL, target);
    } else if (provider === "openai") {
      await settings.update("openai.model", config.model || OPENAI_MODEL, target);
      await settings.update("openai.baseUrl", config.baseUrl ?? "", target);
      await settings.update("openai.reasoningEffort", this.validReasoningEffort(config.reasoningEffort), target);
    } else {
      await settings.update("local.model", config.model || LOCAL_MODEL, target);
      await settings.update("local.baseUrl", config.baseUrl || LOCAL_BASE_URL, target);
    }

    const cfg = await this.resolveLlmConfig(this.workspaceRoot(), this.ctx.extensionPath);
    if ("error" in cfg) {
      this.post({ type: "error", error: cfg.error });
      await this.postLlmConfig();
      return;
    }
    try {
      await this.agent?.updateConfig(cfg);
      await this.postLlmConfig();
    } catch (e: unknown) {
      this.post({ type: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async configureMcp() {
    if (!this.agent) {
      return;
    }
    const cfg = this.resolveMcpConfig();
    await this.agent.configureMcp(cfg);
  }

  private configureMcpSoon() {
    void this.configureMcp().catch((e: unknown) => {
      this.post({ type: "error", error: e instanceof Error ? e.message : String(e) });
    });
  }

  private resolveMcpConfig(): McpConfig {
    const settings = vscode.workspace.getConfiguration("loom");
    return resolveMcpConfig({
      workspaceRoot: this.workspaceRoot(),
      settingsServers: settings.get("mcp.servers"),
    });
  }

  private async approveLocalTool(call: ToolCall): Promise<{ approved: boolean }> {
    this.toolStartTimes.set(call.callId, Date.now());
    if (this.isApprovedByHostPolicy(call)) {
      this.post({ type: "toolCall", call: { ...call, requiresApproval: false } });
      return { approved: true };
    }

    this.post({ type: "toolCall", call });
    const approved = await new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(call.callId, resolve);
      this.pendingApprovalCalls.set(call.callId, call);
    });
    if (!approved) {
      this.post({
        type: "toolResult",
        callId: call.callId,
        ok: false,
        summary: "rejected",
        durationMs: this.finishToolTiming(call.callId),
      });
      return { approved: false };
    }
    return { approved: true };
  }

  private handleMcpStatus(status: McpServerStatus) {
    this.post({ type: "mcpStatus", status }, false);
    if (status.state === "error" || status.state === "failed" || status.state === "crashed") {
      const details = status.message ? `: ${status.message}` : "";
      this.post({ type: "error", error: `MCP ${status.server} ${status.state}${details}` });
    }
  }

  private async postLlmConfig() {
    this.post({ type: "llmConfig", llmConfig: await this.currentLlmConfigView() }, false);
  }

  private async currentLlmConfigView(): Promise<LlmConfigView> {
    const workspaceRoot = this.workspaceRoot();
    const { pick } = this.configPickers(workspaceRoot, this.ctx.extensionPath);
    const rawProvider = pick("provider", "MY_AGENT_PROVIDER") || "anthropic";
    const provider = this.validProvider(rawProvider) ? rawProvider : "anthropic";
    const apiKeys = {
      anthropic: await this.hasApiKey("anthropic", "anthropicApiKey", "ANTHROPIC_API_KEY"),
      openai: await this.hasApiKey("openai", "openai.apiKey", "OPENAI_API_KEY"),
    };
    if (provider === "openai") {
      const reasoningEffort = this.validReasoningEffort(pick("openai.reasoningEffort", "OPENAI_REASONING_EFFORT"));
      return {
        provider,
        model: pick("openai.model", "OPENAI_MODEL") || OPENAI_MODEL,
        baseUrl: pick("openai.baseUrl", "OPENAI_BASE_URL") || undefined,
        reasoningEffort,
        hasApiKey: apiKeys.openai,
        apiKeys,
      };
    }
    if (provider === "local") {
      return {
        provider,
        model: pick("local.model", "OPENAI_MODEL") || LOCAL_MODEL,
        baseUrl: pick("local.baseUrl", "OPENAI_BASE_URL") || LOCAL_BASE_URL,
        hasApiKey: true,
        apiKeys,
      };
    }
    return {
      provider,
      model: pick("model", "MY_AGENT_MODEL") || ANTHROPIC_MODEL,
      hasApiKey: apiKeys.anthropic,
      apiKeys,
    };
  }

  // Resolves LLM config from SecretStorage, VS Code settings, the workspace
  // .env file, and process.env (in that precedence).
  private async resolveLlmConfig(
    workspaceRoot: string,
    extensionPath: string,
  ): Promise<LlmConfig | { error: string }> {
    const { pick, dotenv, dotenvSource } = this.configPickers(workspaceRoot, extensionPath);
    const pickApiKey = async (
      providerName: "anthropic" | "openai",
      settingKey: string,
      envKey: string,
    ): Promise<string> => {
      const secret = await this.ctx.secrets.get(secretKeyFor(providerName));
      if (secret) return secret;
      return pick(settingKey, envKey);
    };

    const provider = (pick("provider", "MY_AGENT_PROVIDER") || "anthropic") as LlmProvider;

    const dotenvFound = Object.keys(dotenv).length > 0;
    console.error(
      `[loom] resolveLlmConfig: workspaceRoot=${workspaceRoot || "<none>"} ` +
      `.env=${dotenvFound ? `loaded from ${dotenvSource}` : "missing"} provider=${provider}`
    );

    if (provider === "openai") {
      const apiKey = await pickApiKey("openai", "openai.apiKey", "OPENAI_API_KEY");
      if (!apiKey) {
        return { error: "Run Loom: Set OpenAI API Key, set loom.openai.apiKey, OPENAI_API_KEY in .env, or set it in the environment." };
      }
      const model = pick("openai.model", "OPENAI_MODEL") || OPENAI_MODEL;
      const baseUrl = pick("openai.baseUrl", "OPENAI_BASE_URL");
      const validEffort = this.validReasoningEffort(pick("openai.reasoningEffort", "OPENAI_REASONING_EFFORT"));
      return {
        provider: "openai",
        openai: { apiKey, model, baseUrl: baseUrl || undefined, reasoningEffort: validEffort },
      };
    }

    if (provider === "anthropic") {
      const apiKey = await pickApiKey("anthropic", "anthropicApiKey", "ANTHROPIC_API_KEY");
      if (!apiKey) {
        return { error: "Run Loom: Set Anthropic API Key, set loom.anthropicApiKey, ANTHROPIC_API_KEY in .env, or set it in the environment." };
      }
      const model = pick("model", "MY_AGENT_MODEL") || ANTHROPIC_MODEL;
      return { provider: "anthropic", anthropic: { apiKey, model } };
    }

    if (provider === "local") {
      const model = pick("local.model", "OPENAI_MODEL") || LOCAL_MODEL;
      const baseUrl = pick("local.baseUrl", "OPENAI_BASE_URL") || LOCAL_BASE_URL;
      return { provider: "local", local: { model, baseUrl } };
    }

    return { error: `Unknown provider "${provider}" - expected openai, anthropic, or local.` };
  }

  private async hasApiKey(
    provider: "anthropic" | "openai",
    settingKey: string,
    envKey: string,
  ): Promise<boolean> {
    const secret = await this.ctx.secrets.get(secretKeyFor(provider));
    if (secret) return true;
    const { pick } = this.configPickers(this.workspaceRoot(), this.ctx.extensionPath);
    return Boolean(pick(settingKey, envKey));
  }

  private configPickers(workspaceRoot: string, extensionPath: string) {
    const settings = vscode.workspace.getConfiguration("loom");
    let dotenv = loadDotEnv(workspaceRoot);
    let dotenvSource = workspaceRoot;
    if (Object.keys(dotenv).length === 0 && extensionPath) {
      dotenv = loadDotEnv(extensionPath);
      dotenvSource = extensionPath;
    }
    const pick = (settingKey: string, envKey: string): string => {
      const ins = settings.inspect<string>(settingKey);
      const explicit =
        ins?.workspaceFolderValue ??
        ins?.workspaceValue ??
        ins?.globalValue;
      if (explicit) return explicit;
      if (dotenv[envKey]) return dotenv[envKey];
      return process.env[envKey] ?? "";
    };
    return { pick, dotenv, dotenvSource };
  }

  private workspaceRoot(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  }

  private configurationTarget(): vscode.ConfigurationTarget {
    return vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  }

  private validProvider(provider: string): provider is LlmProvider {
    return provider === "anthropic" || provider === "openai" || provider === "local";
  }

  private validReasoningEffort(value: string | undefined): ReasoningEffort {
    return value === "low" || value === "medium" || value === "high" ? value : "";
  }

  private getHtml(webview: vscode.Webview): string {
    const distDir = vscode.Uri.joinPath(this.ctx.extensionUri, "dist", "webview");
    const indexHtmlPath = path.join(distDir.fsPath, "index.html");
    if (!fs.existsSync(indexHtmlPath)) {
      return `<!doctype html><html><body><p>Webview not built. Run <code>npm run build:webview</code>.</p></body></html>`;
    }
    let html = fs.readFileSync(indexHtmlPath, "utf8");
    html = html.replace(/(href|src)="\/?([^"]+)"/g, (_, attr, p) => {
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(distDir, p));
      return `${attr}="${uri}"`;
    });
    html = html.replaceAll("__CSP_SOURCE__", webview.cspSource);
    return html;
  }
}

function updateTool(
  messages: Msg[],
  callId: string,
  update: (tool: Extract<Msg, { role: "tool" }>) => Msg,
) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const tool = messages[i];
    if (tool.role === "tool" && tool.callId === callId) {
      messages[i] = update(tool) as Msg;
      break;
    }
  }
}

function mergeToolOutput(current: string | undefined, summary: string): string {
  if (!current) return summary;
  const trimmed = summary.trim();
  if (!trimmed || current.includes(trimmed)) return current;
  return `${current.trimEnd()}\n\n${summary}`;
}
