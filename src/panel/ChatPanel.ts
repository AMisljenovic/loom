import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { AgentClient, LlmConfig, LlmProvider } from "../agentClient";
import { loadDotEnv } from "../env";
import type {
  ConversationState,
  ConversationUpdated,
  HostToWebview,
  Msg,
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

const STATE_KEY = "myAgent.conversation";

export class ChatPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = "myAgent.chat";

  private view?: vscode.WebviewView;
  private agent?: AgentClient;
  private pendingApprovals = new Map<string, (ok: boolean) => void>();
  private toolStartTimes = new Map<string, number>();
  private state: ConversationState;
  private persistTimer?: NodeJS.Timeout;
  private activeTaskId?: string;
  private busy = false;
  private queuedPrompt?: string;
  private assistantIndex: number | null = null;
  private hydratedConversationId?: string;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.state = this.loadState();
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "dist", "webview")],
    };
    view.webview.html = this.getHtml(view.webview);
    view.webview.onDidReceiveMessage((m: WebviewToHost) => this.onWebviewMessage(m));
  }

  private post(msg: HostToWebview, mirror = true) {
    if (mirror) {
      this.mirrorHostMessage(msg);
    }
    this.view?.webview.postMessage(msg);
  }

  private async onWebviewMessage(m: WebviewToHost) {
    if (m.type === "ready") {
      this.restoreWebview();
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
    } else if (m.type === "approve") {
      this.pendingApprovals.get(m.callId)?.(m.approved);
      this.pendingApprovals.delete(m.callId);
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
      await this.agent?.startTask({
        taskId,
        conversationId: this.state.conversationId,
        prompt,
        workspaceRoot,
        cwd: workspaceRoot,
      });
    } catch (e: unknown) {
      this.activeTaskId = undefined;
      this.busy = false;
      this.post({ type: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async ensureAgent(workspaceRoot: string): Promise<boolean> {
    if (!this.agent) {
      const cfg = this.resolveLlmConfig(workspaceRoot, this.ctx.extensionPath);
      if ("error" in cfg) {
        this.post({ type: "error", error: cfg.error });
        return false;
      }
      this.agent = this.createAgent(workspaceRoot);
      await this.agent.start(cfg);
    }

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
          if (call.name === "apply_diff") {
            try {
              const plan = await prepareApplyDiff(call, { workspaceRoot });
              cachePreparedApplyDiff(plan);
              setDiffPreview(call.callId, plan.relPath, plan.before, plan.after);
              await openDiffPreview(call.callId, plan.relPath);
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
    this.toolStartTimes.clear();
    this.persistNow();
    this.restoreWebview();
  }

  private restoreWebview() {
    this.post({
      type: "restore",
      messages: this.state.messages,
      conversationId: this.state.conversationId,
      usage: this.state.usage,
    }, false);
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
    void this.ctx.workspaceState.update(STATE_KEY, this.state);
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

  // Resolves LLM config from VS Code settings, the workspace .env file, and
  // process.env (in that precedence). Returns either the validated config or
  // a user-facing error message. extensionPath is used as a fallback location
  // for .env so developers running the extension via F5 in this repo get
  // their .env picked up even if no workspace folder is open.
  private resolveLlmConfig(
    workspaceRoot: string,
    extensionPath: string,
  ): LlmConfig | { error: string } {
    const settings = vscode.workspace.getConfiguration("myAgent");
    let dotenv = loadDotEnv(workspaceRoot);
    let dotenvSource = workspaceRoot;
    if (Object.keys(dotenv).length === 0 && extensionPath) {
      dotenv = loadDotEnv(extensionPath);
      dotenvSource = extensionPath;
    }
    // Use inspect() so the package.json `default` value never beats .env.
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

    const provider = (pick("provider", "MY_AGENT_PROVIDER") || "anthropic") as LlmProvider;

    const dotenvFound = Object.keys(dotenv).length > 0;
    console.error(
      `[loom] resolveLlmConfig: workspaceRoot=${workspaceRoot || "<none>"} ` +
      `.env=${dotenvFound ? `loaded from ${dotenvSource}` : "missing"} provider=${provider}`
    );

    if (provider === "openai") {
      const apiKey = pick("openai.apiKey", "OPENAI_API_KEY");
      if (!apiKey) {
        return { error: "Set myAgent.openai.apiKey, OPENAI_API_KEY in .env, or in the environment." };
      }
      const model = pick("openai.model", "OPENAI_MODEL") || "gpt-5";
      const baseUrl = pick("openai.baseUrl", "OPENAI_BASE_URL");
      const reasoningEffort = pick("openai.reasoningEffort", "OPENAI_REASONING_EFFORT");
      const validEffort = ["", "low", "medium", "high"].includes(reasoningEffort)
        ? (reasoningEffort as "" | "low" | "medium" | "high")
        : "";
      return {
        provider: "openai",
        openai: { apiKey, model, baseUrl: baseUrl || undefined, reasoningEffort: validEffort },
      };
    }

    if (provider === "anthropic") {
      const apiKey = pick("anthropicApiKey", "ANTHROPIC_API_KEY");
      if (!apiKey) {
        return { error: "Set myAgent.anthropicApiKey, ANTHROPIC_API_KEY in .env, or in the environment." };
      }
      const model = pick("model", "MY_AGENT_MODEL") || "claude-opus-4-7";
      return { provider: "anthropic", anthropic: { apiKey, model } };
    }

    return { error: `Unknown provider "${provider}" - expected openai or anthropic.` };
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
