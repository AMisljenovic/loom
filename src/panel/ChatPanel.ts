import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { AgentClient, AgentSpawnExtras, LlmConfig } from "../agentClient";
import { DEFAULT_AUTO_APPROVE_CONFIG, migrateAutoApprove, normalizeAutoApprove } from "../approval/categories";
import { consumeHostApprovalPolicy } from "../approval/hostPolicy";
import { loadDotEnv } from "../env";
import { resolveMcpConfig } from "../mcpConfig";
import { BUILTIN_MODES, mergeModes } from "../modes";
import { secretKeyFor } from "../secrets";
import { detectModeSwitchIntent } from "../shared/modeIntent";
import { extractProposedPlan } from "../shared/plans";
import { progressKey, shouldAppendProgress } from "../shared/progress";
import type {
  AlwaysAllowRule,
  AskQuestionsInput,
  AutoApproveCategory,
  AutoApproveConfig,
  ConversationState,
  ConversationUpdated,
  FirstRunState,
  HostToWebview,
  LlmConfigView,
  LlmProvider,
  McpConfig,
  McpServerStatus,
  ModeDefinition,
  Msg,
  ProgressPhase,
  QuestionAnswer,
  ReasoningEffort,
  ReferenceAttachment,
  SessionMeta,
  SessionsIndex,
  SubAgentDone,
  SubAgentSpawn,
  TaskDone,
  TaskUsage,
  ToolApproveBatchParams,
  ToolApproveBatchResult,
  ToolCall,
  ToolResult,
  WebviewToHost,
} from "../shared/protocol";
import {
  formatQuestionToolResult,
  normalizeAskQuestionsInput,
  normalizeQuestionAnswers,
} from "../shared/questions";
import {
  mergeReferenceAttachments,
  normalizeReferenceAttachments,
  referenceId,
  referenceLabel,
} from "../shared/references";
import { legacySessionBodyIds, normalizeStoredConversationState, sessionBodyFileName } from "../shared/sessionStorage";
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

const LEGACY_STATE_KEY = "loom.conversation";
const SESSIONS_INDEX_KEY = "loom.sessions.index";
const SESSION_BODY_PREFIX = "loom.sessions.body:";
const AUTO_APPROVE_KEY = "loom.autoApprove";
const ALWAYS_ALLOW_KEY = "loom.alwaysAllow";
const MODE_KEY = "loom.currentMode";
const FIRST_RUN_KEY = "loom.firstRun.completed";
const MAX_TITLE_LEN = 60;
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
  private sessions: SessionsIndex;
  private autoApprove: AutoApproveConfig = { ...DEFAULT_AUTO_APPROVE_CONFIG, categories: { ...DEFAULT_AUTO_APPROVE_CONFIG.categories } };
  private alwaysAllow: AlwaysAllowRule[] = [];
  private currentModeId: string = "code";
  private sessionBulkCounters = new Map<string, number>();
  private persistTimer?: NodeJS.Timeout;
  private activeTaskId?: string;
  private busy = false;
  private queuedPrompt?: string;
  private queuedModeId?: string;
  private queuedReferences?: ReferenceAttachment[];
  private assistantIndex: number | null = null;
  private hydratedConversationId?: string;
  private webviewMessageQueue: Promise<void> = Promise.resolve();
  private readonly output: vscode.OutputChannel;
  private activeSubAgents = new Map<string, { parentTaskId: string; type: string; task: string }>();
  private toolCallTasks = new Map<string, string>();
  private activeToolCalls = new Map<string, ToolCall>();
  private cancelledTaskIds = new Set<string>();
  private pendingQuestions = new Map<string, {
    request: AskQuestionsInput;
    resolve: (result: ToolResult) => void;
  }>();
  private activeTaskModeId?: string;
  private activeProgressKeys = new Set<string>();
  private activeTaskSawDelta = false;
  private refIndex?: { files: string[]; folders: string[]; stamp: number };

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel("Loom");
    this.ctx.subscriptions.push(this.output);
    this.sessions = this.loadSessions();
    this.state = this.loadSessionBody(this.sessions.activeId);
    this.autoApprove = migrateAutoApprove(this.ctx.workspaceState.get<unknown>(AUTO_APPROVE_KEY));
    this.alwaysAllow = this.loadAlwaysAllow();
    this.currentModeId = this.ctx.workspaceState.get<string>(MODE_KEY) ?? "code";
    this.ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("loom.mcp")) {
        this.configureMcpSoon();
      }
      if (e.affectsConfiguration("loom.ui")) {
        this.postThemeConfig();
      }
    }));
    this.ctx.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(() => this.postThemeConfig()));
    const watcher = vscode.workspace.createFileSystemWatcher("**/.vscode/mcp.json");
    watcher.onDidCreate(() => this.configureMcpSoon(), this, this.ctx.subscriptions);
    watcher.onDidChange(() => this.configureMcpSoon(), this, this.ctx.subscriptions);
    watcher.onDidDelete(() => this.configureMcpSoon(), this, this.ctx.subscriptions);
    this.ctx.subscriptions.push(watcher);
    this.ctx.subscriptions.push(
      vscode.workspace.onDidCreateFiles(() => { this.refIndex = undefined; }),
      vscode.workspace.onDidDeleteFiles(() => { this.refIndex = undefined; }),
      vscode.workspace.onDidRenameFiles(() => { this.refIndex = undefined; }),
    );
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
    try {
      this.ensureStateShape();
      if (mirror) {
        this.mirrorHostMessage(msg);
      }
    } catch (e: unknown) {
      this.log(`state mirror failed for ${msg.type}: ${e instanceof Error ? e.message : String(e)}`);
      this.repairStateShape();
    }
    this.view?.webview.postMessage(msg);
  }

  private emitProgress(phase: ProgressPhase, text: string) {
    const clean = text.trim();
    if (!clean || !shouldAppendProgress(this.state.messages, phase, clean)) {
      return;
    }
    const key = progressKey(phase, clean);
    if (this.activeProgressKeys.has(key)) {
      return;
    }
    this.activeProgressKeys.add(key);
    this.post({ type: "progress", phase, text: clean, createdAt: Date.now() });
  }

  private emitProgressForTool(call: ToolCall) {
    const detail = toolProgressDetail(call);
    switch (call.name) {
      case "read_file":
      case "list_dir":
      case "get_diagnostics":
      case "load_skill":
      case "find_symbol":
      case "find_references":
      case "semantic_search":
        this.emitProgress("reading", detail);
        break;
      case "search":
        this.emitProgress("searching", detail);
        break;
      case "apply_diff":
        this.emitProgress(call.requiresApproval ? "waiting" : "changing", detail);
        break;
      case "run_command":
      case "run_command_background":
      case "read_process_output":
      case "kill_process":
        this.emitProgress(call.requiresApproval ? "waiting" : "executing", detail);
        break;
      case "spawn_subagent":
        this.emitProgress("researching", detail);
        break;
      default:
        this.emitProgress("reading", detail);
    }
  }

  private emitProgressAfterToolResult(call: ToolCall, result: ToolResult) {
    if (!result.ok) {
      this.emitProgress("thinking", `${toolNoun(call)} stopped; checking the next step.`);
      return;
    }
    const detail = toolResultProgressDetail(call);
    if (detail) {
      this.emitProgress("thinking", detail);
    }
  }

  private async buildRefIndex(): Promise<void> {
    const exclude = "**/{.git,node_modules,dist,bin,.loom}/**";
    const uris = await vscode.workspace.findFiles("**/*", exclude, 5000);
    const files: string[] = [];
    const folderSet = new Set<string>();
    for (const uri of uris) {
      const rel = this.workspaceRelativePath(uri.fsPath);
      if (rel && rel !== ".") {
        files.push(rel);
        const parts = rel.split("/");
        for (let i = 1; i < parts.length; i++) {
          folderSet.add(parts.slice(0, i).join("/"));
        }
      }
    }
    this.refIndex = { files, folders: [...folderSet], stamp: Date.now() };
  }

  private searchRef(query: string, existing: ReferenceAttachment[]): ReferenceAttachment[] {
    if (!this.refIndex) return [];
    const existingIds = new Set(existing.map((r) => r.id));
    const q = query.toLowerCase();
    const score = (p: string): number => {
      const base = (p.split("/").pop() ?? "").toLowerCase();
      const pl = p.toLowerCase();
      if (base === q) return 3;
      if (base.startsWith(q)) return 2;
      if (base.includes(q)) return 1;
      if (pl.includes(q)) return 0;
      return -1;
    };
    const candidates: Array<{ kind: "file" | "folder"; path: string; sc: number }> = [];
    for (const f of this.refIndex.files) {
      const sc = score(f);
      if (sc >= 0) candidates.push({ kind: "file", path: f, sc });
    }
    for (const d of this.refIndex.folders) {
      const sc = score(d);
      if (sc >= 0) candidates.push({ kind: "folder", path: d, sc });
    }
    candidates.sort((a, b) => b.sc - a.sc);
    const results: ReferenceAttachment[] = [];
    for (const c of candidates) {
      if (results.length >= 10) break;
      const id = referenceId(c.kind, c.path);
      if (existingIds.has(id)) continue;
      results.push({ id, kind: c.kind, path: c.path, label: referenceLabel(c.path) });
    }
    return results;
  }

  private async pickReferences(existing: ReferenceAttachment[] | undefined) {
    const workspaceRoot = this.workspaceRoot();
    if (!workspaceRoot) {
      this.post({ type: "referencePickError", error: "Open a workspace before adding references." }, false);
      return;
    }
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: true,
      canSelectMany: true,
      defaultUri: vscode.Uri.file(workspaceRoot),
      openLabel: "Add references",
      title: "Add Loom references",
    });
    if (!picked || picked.length === 0) {
      return;
    }
    const added: ReferenceAttachment[] = [];
    for (const uri of picked) {
      const rel = this.workspaceRelativePath(uri.fsPath);
      if (!rel) {
        this.post({ type: "referencePickError", error: `${uri.fsPath} is outside the workspace.` }, false);
        continue;
      }
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        const kind: ReferenceAttachment["kind"] = stat.type & vscode.FileType.Directory ? "folder" : "file";
        added.push({
          id: referenceId(kind, rel),
          kind,
          path: rel,
          label: referenceLabel(rel),
        });
      } catch (e: unknown) {
        this.post({ type: "referencePickError", error: e instanceof Error ? e.message : String(e) }, false);
      }
    }
    const references = mergeReferenceAttachments(normalizeReferenceAttachments(existing), added);
    this.post({ type: "referencesPicked", references }, false);
  }

  private workspaceRelativePath(fsPath: string): string | undefined {
    const workspaceRoot = this.workspaceRoot();
    if (!workspaceRoot) {
      return undefined;
    }
    const rootAbs = path.resolve(workspaceRoot);
    const full = path.resolve(fsPath);
    if (full !== rootAbs && !full.startsWith(rootAbs + path.sep)) {
      return undefined;
    }
    const rel = path.relative(rootAbs, full).split(path.sep).join("/") || ".";
    return rel.startsWith("..") ? undefined : rel;
  }

  private async onWebviewMessage(m: WebviewToHost) {
    if (m.type === "ready") {
      await this.restoreWebview();
    } else if (m.type === "submit") {
      if (this.busy) {
        this.queuedPrompt = m.prompt;
        this.queuedModeId = this.validModeId(m.modeId) ? m.modeId : undefined;
        this.queuedReferences = normalizeReferenceAttachments(m.references);
        this.cancelActiveTask();
        const next = this.queuedPrompt;
        const nextModeId = this.queuedModeId;
        const nextReferences = this.queuedReferences;
        this.queuedPrompt = undefined;
        this.queuedModeId = undefined;
        this.queuedReferences = undefined;
        if (next) {
          await this.runTask(next, nextModeId, nextReferences);
        }
        return;
      }
      await this.runTask(m.prompt, m.modeId, m.references);
    } else if (m.type === "cancel") {
      this.cancelActiveTask();
    } else if (m.type === "newConversation") {
      await this.newConversation();
    } else if (m.type === "pickReferences") {
      await this.pickReferences(m.existing);
    } else if (m.type === "referenceSearch") {
      if (!this.refIndex) {
        await this.buildRefIndex();
      }
      const suggestions = this.searchRef(m.query, m.existing ?? []);
      this.post({ type: "referenceSuggestions", requestId: m.requestId, query: m.query, suggestions }, false);
    } else if (m.type === "switchSession") {
      await this.switchSession(m.conversationId);
    } else if (m.type === "archiveSession") {
      await this.archiveSession(m.conversationId, true);
    } else if (m.type === "unarchiveSession") {
      await this.archiveSession(m.conversationId, false);
    } else if (m.type === "togglePinSession") {
      this.togglePinSession(m.conversationId);
    } else if (m.type === "renameSession") {
      this.renameSession(m.conversationId, m.title);
    } else if (m.type === "deleteSession") {
      await this.deleteSession(m.conversationId);
    } else if (m.type === "setSecret") {
      if (m.apiKey.trim()) {
        await this.ctx.secrets.store(secretKeyFor(m.provider), m.apiKey.trim());
      }
      await this.postLlmConfig();
      await this.postFirstRunState();
    } else if (m.type === "setLlmConfig") {
      await this.applyLlmConfig(m.config);
    } else if (m.type === "completeFirstRun") {
      await this.ctx.workspaceState.update(FIRST_RUN_KEY, true);
      await this.postFirstRunState();
    } else if (m.type === "approve") {
      const call = this.pendingApprovalCalls.get(m.callId);
      if (m.approved) {
        if (m.rememberRule) {
          this.addAlwaysAllowRule(m.rememberRule);
        }
        if (m.autoApproveCategory) {
          this.toggleAutoApproveCategory(m.autoApproveCategory, true);
        }
        if (call && typeof m.sessionCount === "number" && m.sessionCount > 0) {
          this.sessionBulkCounters.set(call.name, Math.floor(m.sessionCount));
        }
      }
      this.pendingApprovals.get(m.callId)?.(m.approved);
      this.pendingApprovals.delete(m.callId);
      this.pendingApprovalCalls.delete(m.callId);
    } else if (m.type === "answerQuestions") {
      this.answerQuestions(m.callId, m.answers);
    } else if (m.type === "setAutoApprove") {
      this.autoApprove = normalizeAutoApprove(m.config);
      this.schedulePersist();
      this.postAutoApprove();
    } else if (m.type === "removeAlwaysAllowRule") {
      this.alwaysAllow = this.alwaysAllow.filter((rule) => rule.id !== m.id);
      this.schedulePersist();
      this.postAlwaysAllowList();
    } else if (m.type === "requestAlwaysAllowList") {
      this.postAlwaysAllowList();
    } else if (m.type === "subagentCancel") {
      await this.agent?.cancel(m.subTaskId);
    } else if (m.type === "setMode") {
      this.currentModeId = m.modeId;
      this.schedulePersist();
      this.postModes();
    }
  }

  private async runTask(prompt: string, requestedModeId?: string, references?: ReferenceAttachment[]) {
    this.ensureStateShape();
    const taskReferences = normalizeReferenceAttachments(references);
    if (this.validModeId(requestedModeId)) {
      this.currentModeId = requestedModeId;
      this.schedulePersist();
      this.postModes();
    }
    const preparedPrompt = await this.applyModeIntent(prompt);
    if (preparedPrompt === undefined) {
      return;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    if (!(await this.ensureAgent(workspaceRoot))) {
      return;
    }

    const taskId = randomUUID();
    this.activeTaskId = taskId;
    this.activeTaskModeId = this.currentModeId;
    this.activeProgressKeys.clear();
    this.activeTaskSawDelta = false;
    this.busy = true;
    this.state.messages.push({ role: "user", text: preparedPrompt, references: taskReferences });
    this.assistantIndex = null;
    this.schedulePersist();
    this.emitProgress("started", `Started ${activeModeLabel(this.currentModeId, this.getModes())} task.`);

    try {
      const modes = this.getModes();
      const activeMode = modes.find((m) => m.id === this.currentModeId);
      await this.agent?.startTask({
        taskId,
        conversationId: this.state.conversationId,
        prompt: preparedPrompt,
        workspaceRoot,
        cwd: workspaceRoot,
        mode: activeMode,
        references: taskReferences,
      });
    } catch (e: unknown) {
      this.activeTaskId = undefined;
      this.activeTaskModeId = undefined;
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

  private buildSpawnExtras(): AgentSpawnExtras {
    const settings = vscode.workspace.getConfiguration("loom");
    const telemetryEnabled = settings.get<boolean>("telemetry.enabled", false);
    const telemetryEndpoint = settings.get<string>("telemetry.endpoint", "");
    const embedProvider = settings.get<string>("embeddings.provider", "disabled");
    const embedModel = settings.get<string>("embeddings.model", "");
    const validProvider: "disabled" | "ollama" | "voyage" =
      embedProvider === "ollama" || embedProvider === "voyage" ? embedProvider : "disabled";
    return {
      telemetry: {
        enabled: telemetryEnabled,
        endpoint: telemetryEndpoint || undefined,
        machineIdHash: telemetryEnabled
          ? createHash("sha256").update(vscode.env.machineId).digest("hex")
          : undefined,
      },
      embeddings: {
        provider: validProvider,
        model: embedModel || undefined,
      },
    };
  }

  private createAgent(workspaceRoot: string): AgentClient {
    return new AgentClient(this.ctx.extensionPath, {
      onDelta: ({ taskId, text }) => {
        if (this.cancelledTaskIds.has(taskId)) {
          return;
        }
        if (this.activeSubAgents.has(taskId)) {
          this.post({ type: "subagentDelta", subTaskId: taskId, text });
        } else {
          if (!this.activeTaskSawDelta && text.trim()) {
            this.activeTaskSawDelta = true;
            this.emitProgress("writing", "Writing the response.");
          }
          this.post({ type: "delta", text });
        }
      },
      onToolStart: (call: ToolCall) => {
        this.routeToolCall(call);
      },
      onToolResult: (result: ToolResult) => {
        this.routeToolResult(result);
      },
      onToolCall: async (call: ToolCall) => {
        if (call.name === "ask_questions") {
          return this.handleAskQuestions(call);
        }
        this.toolStartTimes.set(call.callId, Date.now());
        if (call.requiresApproval) {
          if (this.isApprovedByHostPolicy(call)) {
            this.routeToolCall({ ...call, requiresApproval: false });
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
                this.routeToolCall(call);
                this.routeToolResult(result);
                return result;
              }
            }
            this.routeToolCall(call);
            const approved = await new Promise<boolean>((resolve) => {
              this.pendingApprovals.set(call.callId, resolve);
              this.pendingApprovalCalls.set(call.callId, call);
            });
            if (!approved) {
              await this.cleanupApplyDiff(call.callId);
              this.routeToolResult({ callId: call.callId, ok: false, error: "rejected" });
              return { callId: call.callId, ok: false, error: "user rejected" };
            }
          }
        } else {
          this.routeToolCall(call);
        }
        try {
          const result = await executeTool(call, async () => true, {
            workspaceRoot,
            onProgress: (chunk) => this.routeToolProgress(call.callId, chunk),
          });
          this.routeToolResult(result);
          return result;
        } finally {
          if (call.name === "apply_diff") {
            await this.cleanupApplyDiff(call.callId);
          }
        }
      },
      onToolApprove: async (call: ToolCall) => this.approveLocalTool(call),
      onToolApproveBatch: async (params: ToolApproveBatchParams) => this.approveLocalToolBatch(params, workspaceRoot),
      onMcpStatus: (status) => this.handleMcpStatus(status),
      onDone: (done) => this.handleDone(done),
      onUsage: (usage) => this.handleUsage(usage),
      onConversationUpdated: (update) => this.handleConversationUpdated(update),
      onSummarized: ({ droppedCount }) => this.post({ type: "summarized", droppedCount }),
      onIndexStatus: (status) => this.post({ type: "indexStatus", status }, false),
      onSubAgentSpawn: (spawn) => this.handleSubAgentSpawn(spawn),
      onSubAgentDone: (done) => this.handleSubAgentDone(done),
      onError: (error) => this.post({ type: "error", error }),
      onLog: (line) => this.log(line),
    }, this.buildSpawnExtras());
  }

  private async applyModeIntent(prompt: string): Promise<string | undefined> {
    const intent = detectModeSwitchIntent(prompt, this.getModes());
    if (!intent) {
      return prompt;
    }

    this.currentModeId = intent.modeId;
    this.schedulePersist();
    this.postModes();
    this.post({
      type: "modeAutoChanged",
      modeId: intent.modeId,
      label: intent.label,
      prompt: intent.prompt,
    }, false);
    if (!intent.prompt) {
      this.post({ type: "done", reason: "completed" }, false);
    }
    return intent.prompt;
  }

  private handleSubAgentSpawn(spawn: SubAgentSpawn) {
    this.activeSubAgents.set(spawn.subTaskId, {
      parentTaskId: spawn.parentTaskId,
      type: spawn.type,
      task: spawn.task,
    });
    this.post({
      type: "subagentSpawn",
      parentTaskId: spawn.parentTaskId,
      subTaskId: spawn.subTaskId,
      subagentType: spawn.type,
      task: spawn.task,
    });
    this.emitProgress("researching", `Started research: ${trimProgressDetail(spawn.task)}`);
  }

  private handleSubAgentDone(done: SubAgentDone) {
    this.post({
      type: "subagentDone",
      subTaskId: done.subTaskId,
      status: done.status,
      summary: done.summary,
      toolCalls: done.toolCalls,
      tokensUsed: done.tokensUsed,
      inputTokens: done.inputTokens,
      outputTokens: done.outputTokens,
      truncated: done.truncated,
    });
    this.activeSubAgents.delete(done.subTaskId);
    this.emitProgress("researching", `Research ${done.status}: ${trimProgressDetail(done.summary || done.subTaskId)}`);
  }

  private routeToolCall(call: ToolCall) {
    if (this.cancelledTaskIds.has(call.taskId)) {
      return;
    }
    this.toolStartTimes.set(call.callId, Date.now());
    this.toolCallTasks.set(call.callId, call.taskId);
    this.activeToolCalls.set(call.callId, call);
    const subAgent = this.activeSubAgents.get(call.taskId);
    if (subAgent) {
      this.post({
        type: "subagentToolCall",
        subTaskId: call.taskId,
        call: { ...call, subAgent: { type: subAgent.type, task: subAgent.task } },
      });
      return;
    }
    this.emitProgressForTool(call);
    this.post({ type: "toolCall", call });
  }

  private routeToolProgress(callId: string, chunk: string) {
    const taskId = this.toolCallTasks.get(callId);
    if (taskId && this.activeSubAgents.has(taskId)) {
      this.post({ type: "subagentToolProgress", subTaskId: taskId, callId, chunk });
      return;
    }
    this.post({ type: "toolProgress", callId, chunk });
  }

  private routeToolResult(result: ToolResult) {
    const measured = this.finishToolTiming(result.callId);
    const durationMs = result.durationMs ?? measured;
    const summary = result.content ?? result.error ?? "";
    const taskId = this.toolCallTasks.get(result.callId);
    if (taskId && this.cancelledTaskIds.has(taskId)) {
      this.toolCallTasks.delete(result.callId);
      this.activeToolCalls.delete(result.callId);
      return;
    }
    const call = this.activeToolCalls.get(result.callId);
    this.toolCallTasks.delete(result.callId);
    this.activeToolCalls.delete(result.callId);
    if (taskId && this.activeSubAgents.has(taskId)) {
      this.post({
        type: "subagentToolResult",
        subTaskId: taskId,
        callId: result.callId,
        ok: result.ok,
        summary,
        durationMs,
      });
      return;
    }
    this.post({
      type: "toolResult",
      callId: result.callId,
      ok: result.ok,
      summary,
      durationMs,
    });
    if (call) {
      this.emitProgressAfterToolResult(call, result);
    }
  }

  private async handleAskQuestions(call: ToolCall): Promise<ToolResult> {
    this.toolStartTimes.set(call.callId, Date.now());
    this.toolCallTasks.set(call.callId, call.taskId);
    this.activeToolCalls.set(call.callId, call);
    let request: AskQuestionsInput;
    try {
      request = normalizeAskQuestionsInput(call.input);
    } catch (e: unknown) {
      const result = this.failedToolResult(call.callId, e);
      result.durationMs = this.finishToolTiming(call.callId);
      this.toolCallTasks.delete(call.callId);
      this.activeToolCalls.delete(call.callId);
      return result;
    }
    this.emitProgress("waiting", request.title ? `Waiting for answers: ${request.title}` : "Waiting for answers.");
    this.post({ type: "questionRequest", callId: call.callId, request });
    return new Promise<ToolResult>((resolve) => {
      this.pendingQuestions.set(call.callId, { request, resolve });
    });
  }

  private answerQuestions(callId: string, answers: QuestionAnswer[]) {
    const pending = this.pendingQuestions.get(callId);
    if (!pending) {
      return;
    }
    let normalized: QuestionAnswer[];
    try {
      normalized = normalizeQuestionAnswers(pending.request, answers);
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      this.post({ type: "error", error });
      this.pendingQuestions.delete(callId);
      this.toolCallTasks.delete(callId);
      this.activeToolCalls.delete(callId);
      pending.resolve({ callId, ok: false, error, durationMs: this.finishToolTiming(callId) });
      return;
    }
    this.pendingQuestions.delete(callId);
    this.toolCallTasks.delete(callId);
    this.activeToolCalls.delete(callId);
    this.post({ type: "questionAnswered", callId, answers: normalized });
    this.emitProgress("thinking", "Continuing with your answers.");
    pending.resolve({
      callId,
      ok: true,
      content: formatQuestionToolResult(pending.request, normalized),
      durationMs: this.finishToolTiming(callId),
    });
  }

  private cancelPendingQuestions() {
    for (const [callId, pending] of this.pendingQuestions) {
      pending.resolve({
        callId,
        ok: false,
        error: "cancelled",
        durationMs: this.finishToolTiming(callId),
      });
      this.toolCallTasks.delete(callId);
      this.activeToolCalls.delete(callId);
    }
    this.pendingQuestions.clear();
  }

  private cancelPendingApprovals() {
    for (const [callId, resolve] of this.pendingApprovals) {
      resolve(false);
      this.pendingApprovals.delete(callId);
      this.pendingApprovalCalls.delete(callId);
    }
  }

  private cancelActiveTask() {
    this.cancelPendingQuestions();
    this.cancelPendingApprovals();
    const taskId = this.activeTaskId;
    if (!taskId) {
      return;
    }
    this.cancelledTaskIds.add(taskId);
    this.activeTaskId = undefined;
    this.activeTaskModeId = undefined;
    this.busy = false;
    this.post({ type: "done", reason: "cancelled" });
    this.emitProgress("completed", "Task cancelled.");
    void this.agent?.cancel(taskId).catch((e: unknown) => {
      this.log(`cancel failed for ${taskId}: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  private async handleDone({ taskId, reason }: TaskDone) {
    if (this.activeSubAgents.has(taskId)) {
      return;
    }
    if (this.cancelledTaskIds.delete(taskId) && this.activeTaskId !== taskId) {
      return;
    }
    if (reason !== "completed") {
      this.cancelPendingQuestions();
      this.cancelPendingApprovals();
    }
    if (reason === "completed" && this.activeTaskModeId === "architect") {
      const assistant = this.assistantIndex === null ? undefined : this.state.messages[this.assistantIndex];
      if (assistant?.role === "assistant") {
        const plan = extractProposedPlan(assistant.text);
        if (plan) {
          this.post({ type: "planReady" }, false);
          void this.openPlanPreview(plan.markdown);
        }
      }
    }
    this.post({ type: "done", reason });
    this.emitProgress("completed", reason === "completed" ? "Task completed." : `Task ${reason}.`);
    if (this.activeTaskId === taskId) {
      this.activeTaskId = undefined;
    }
    this.activeTaskModeId = undefined;
    this.busy = false;

    const next = this.queuedPrompt;
    const nextModeId = this.queuedModeId;
    const nextReferences = this.queuedReferences;
    this.queuedPrompt = undefined;
    this.queuedModeId = undefined;
    this.queuedReferences = undefined;
    if (next) {
      await this.runTask(next, nextModeId, nextReferences);
    }
  }

  private handleUsage(usage: TaskUsage) {
    if (this.activeSubAgents.has(usage.taskId)) {
      this.post({
        type: "usage",
        usage: {
          ...this.state.usage,
          subAgentInputTokens: usage.subAgentInputTokens,
          subAgentOutputTokens: usage.subAgentOutputTokens,
          subAgentCount: usage.subAgentCount,
          model: usage.model,
          promptVersion: usage.promptVersion,
        },
      });
      return;
    }
    this.post({
      type: "usage",
      usage: {
        inputTokens: usage.cumulativeInput,
        outputTokens: usage.cumulativeOutput,
        cacheReadTokens: usage.cumulativeCacheRead,
        subAgentInputTokens: usage.subAgentInputTokens,
        subAgentOutputTokens: usage.subAgentOutputTokens,
        subAgentCount: usage.subAgentCount,
        model: usage.model,
        promptVersion: usage.promptVersion,
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
      cacheReadTokens: update.cumulativeCacheRead,
      model: update.model,
      promptVersion: this.state.usage.promptVersion,
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
    // Persist the current session before swapping it out.
    this.persistNow();
    // Create a fresh session and make it active.
    const meta = this.seedSessionInPlace(this.sessions);
    this.state = this.loadSessionBody(meta.conversationId);
    this.hydratedConversationId = undefined;
    this.assistantIndex = null;
    this.pendingApprovals.clear();
    this.pendingApprovalCalls.clear();
    this.cancelPendingQuestions();
    this.sessionBulkCounters.clear();
    this.toolStartTimes.clear();
    this.toolCallTasks.clear();
    this.activeToolCalls.clear();
    this.activeSubAgents.clear();
    this.activeProgressKeys.clear();
    this.queuedReferences = undefined;
    this.persistNow();
    await this.restoreWebview();
    this.postSessions();
  }

  private async switchSession(targetId: string) {
    if (targetId === this.state.conversationId) {
      return;
    }
    if (!this.sessions.sessions[targetId]) {
      return;
    }
    // Cancel any in-flight task before swapping; deltas would otherwise
    // stream into the wrong session.
    if (this.busy && this.activeTaskId) {
      await this.agent?.cancel(this.activeTaskId);
    }
    this.persistNow();
    this.sessions.activeId = targetId;
    // Move target to front of recent order (if not pinned, ordering reflects
    // last touched; the webview still groups Pinned/Recent independently).
    this.sessions.order = [targetId, ...this.sessions.order.filter((id) => id !== targetId)];
    this.state = this.loadSessionBody(targetId);
    this.hydratedConversationId = undefined;
    this.assistantIndex = null;
    this.pendingApprovals.clear();
    this.pendingApprovalCalls.clear();
    this.cancelPendingQuestions();
    this.sessionBulkCounters.clear();
    this.toolStartTimes.clear();
    this.toolCallTasks.clear();
    this.activeToolCalls.clear();
    this.activeSubAgents.clear();
    this.activeProgressKeys.clear();
    this.queuedReferences = undefined;
    this.persistNow();
    await this.restoreWebview();
    this.postSessions();
  }

  private async archiveSession(id: string, archived: boolean) {
    const meta = this.sessions.sessions[id];
    if (!meta) return;
    meta.state = archived ? "archived" : "active";
    if (archived) {
      meta.pinned = false;
      if (id === this.state.conversationId) {
        // Pick a fallback active session: most recent non-archived; if none,
        // seed a fresh one.
        const fallback = this.sessions.order
          .filter((x) => x !== id)
          .find((x) => this.sessions.sessions[x]?.state === "active");
        if (fallback) {
          await this.switchSession(fallback);
        } else {
          await this.newConversation();
        }
        // switchSession/newConversation already called postSessions/persistNow.
        return;
      }
    }
    this.persistNow();
    this.postSessions();
  }

  private togglePinSession(id: string) {
    const meta = this.sessions.sessions[id];
    if (!meta) return;
    meta.pinned = !meta.pinned;
    if (meta.pinned) {
      meta.state = "active"; // pinning auto-unarchives
    }
    this.persistNow();
    this.postSessions();
  }

  private renameSession(id: string, title: string) {
    const meta = this.sessions.sessions[id];
    if (!meta) return;
    meta.title = title.trim().slice(0, MAX_TITLE_LEN);
    this.persistNow();
    this.postSessions();
  }

  private async deleteSession(id: string) {
    if (!this.sessions.sessions[id]) return;
    delete this.sessions.sessions[id];
    this.sessions.order = this.sessions.order.filter((x) => x !== id);
    void this.ctx.workspaceState.update(this.bodyKey(id), undefined);
    this.deleteSessionBodyFile(id);
    if (id === this.state.conversationId) {
      const fallback = this.sessions.order.find((x) => this.sessions.sessions[x]?.state === "active");
      if (fallback) {
        await this.switchSession(fallback);
      } else {
        await this.newConversation();
      }
      return;
    }
    this.persistNow();
    this.postSessions();
  }

  private postSessions() {
    this.post({ type: "sessions", index: this.sessions }, false);
  }

  private async restoreWebview() {
    this.ensureStateShape();
    this.post({
      type: "restore",
      messages: this.state.messages,
      conversationId: this.state.conversationId,
      usage: this.state.usage,
      llmConfig: await this.currentLlmConfigView(),
    }, false);
    this.postSessions();
    this.postAutoApprove();
    this.postAlwaysAllowList();
    this.postModes();
    this.postThemeConfig();
    await this.postFirstRunState();
  }

  private async postFirstRunState() {
    const llmConfig = await this.currentLlmConfigView();
    const state: FirstRunState = {
      completed: this.ctx.workspaceState.get<boolean>(FIRST_RUN_KEY, false),
      needsSetup: !llmConfig.hasApiKey,
      llmConfig,
    };
    this.post({ type: "firstRunState", state }, false);
  }

  private postThemeConfig() {
    const settings = vscode.workspace.getConfiguration("loom");
    const accent = settings.get<string>("ui.accent", "indigo");
    const density = settings.get<string>("ui.density", "comfortable");
    const themeBias = settings.get<string>("ui.themeBias", "auto");
    this.post({ type: "themeConfig", accent, density, themeBias }, false);
  }

  private mirrorHostMessage(msg: HostToWebview) {
    this.ensureStateShape();
    if (msg.type === "delta") {
      if (this.assistantIndex === null || this.state.messages[this.assistantIndex]?.role !== "assistant") {
        this.state.messages.push({ role: "assistant", text: msg.text });
        this.assistantIndex = this.state.messages.length - 1;
      } else {
        const cur = this.state.messages[this.assistantIndex] as Extract<Msg, { role: "assistant" }>;
        this.state.messages[this.assistantIndex] = { ...cur, text: cur.text + msg.text };
      }
      this.schedulePersist();
    } else if (msg.type === "progress") {
      this.state.messages.push({
        role: "progress",
        phase: msg.phase,
        text: msg.text,
        createdAt: msg.createdAt,
      });
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
    } else if (msg.type === "questionRequest") {
      this.state.messages.push({
        role: "question",
        callId: msg.callId,
        title: msg.request.title,
        questions: msg.request.questions,
        status: "pending",
      });
      this.schedulePersist();
    } else if (msg.type === "questionAnswered") {
      this.state.messages = updateQuestion(this.state.messages, msg.callId, (question) => ({
        ...question,
        status: "answered",
        answers: msg.answers,
      }));
      this.schedulePersist();
    } else if (msg.type === "subagentSpawn") {
      this.state.messages.push({
        role: "subagent",
        parentTaskId: msg.parentTaskId,
        subTaskId: msg.subTaskId,
        type: msg.subagentType,
        task: msg.task,
        status: "running",
        trace: [{ role: "user", text: msg.task }],
        expanded: false,
      });
      this.schedulePersist();
    } else if (msg.type === "subagentDelta") {
      updateSubAgent(this.state.messages, msg.subTaskId, (sub) => {
        const trace = [...sub.trace];
        const last = trace[trace.length - 1];
        if (last?.role === "assistant") {
          trace[trace.length - 1] = { ...last, text: last.text + msg.text };
        } else {
          trace.push({ role: "assistant", text: msg.text });
        }
        return { ...sub, trace };
      });
      this.schedulePersist();
    } else if (msg.type === "subagentToolCall") {
      updateSubAgent(this.state.messages, msg.subTaskId, (sub) => ({
        ...sub,
        trace: [
          ...sub.trace,
          {
            role: "tool",
            name: msg.call.name,
            status: msg.call.requiresApproval ? "pending" : "approved",
            callId: msg.call.callId,
            input: msg.call.input,
            expanded: false,
          },
        ],
      }));
      this.schedulePersist();
    } else if (msg.type === "subagentToolProgress") {
      updateSubAgent(this.state.messages, msg.subTaskId, (sub) => ({
        ...sub,
        trace: updateTool(sub.trace, msg.callId, (tool) => ({
          ...tool,
          status: tool.status === "approved" ? "running" : tool.status,
          output: `${tool.output ?? ""}${msg.chunk}`,
          expanded: tool.expanded ?? true,
        })),
      }));
      this.schedulePersist();
    } else if (msg.type === "subagentToolResult") {
      updateSubAgent(this.state.messages, msg.subTaskId, (sub) => ({
        ...sub,
        trace: updateTool(sub.trace, msg.callId, (tool) => {
          const hasOutput = Boolean(tool.output);
          const finalOutput = mergeToolOutput(tool.output, msg.summary);
          const status = !msg.ok && msg.summary === "rejected" ? "rejected" : msg.ok ? "done" : "error";
          return {
            ...tool,
            status,
            output: hasOutput ? finalOutput : msg.summary,
            durationMs: msg.durationMs,
          };
        }),
      }));
      this.schedulePersist();
    } else if (msg.type === "subagentDone") {
      updateSubAgent(this.state.messages, msg.subTaskId, (sub) => ({
        ...sub,
        status: msg.status,
        summary: msg.summary,
        toolCalls: msg.toolCalls,
        tokensUsed: msg.tokensUsed,
        inputTokens: msg.inputTokens,
        outputTokens: msg.outputTokens,
        truncated: msg.truncated,
      }));
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

  private loadSessions(): SessionsIndex {
    this.clearLegacySessionBodiesFromWorkspaceState();
    const saved = this.ctx.workspaceState.get<SessionsIndex>(SESSIONS_INDEX_KEY);
    if (saved && saved.version === 1 && saved.activeId && saved.sessions) {
      saved.order = Array.isArray(saved.order) ? saved.order : Object.keys(saved.sessions);
      for (const id of Object.keys(saved.sessions)) {
        this.migrateWorkspaceStateBodyToFile(id);
      }
      // Defensive: make sure activeId is in the map.
      if (!saved.sessions[saved.activeId]) {
        const firstActive = saved.order.find((id) => saved.sessions[id]?.state === "active");
        saved.activeId = firstActive ?? this.seedSessionInPlace(saved).conversationId;
      }
      return saved;
    }
    // Migration: lift legacy single-conversation state into a session row.
    const legacy = this.ctx.workspaceState.get<ConversationState>(LEGACY_STATE_KEY);
    if (legacy?.conversationId && Array.isArray(legacy.messages) && Array.isArray(legacy.llmMessages)) {
      const meta = this.makeMeta(legacy.conversationId, deriveTitleFromMessages(legacy.messages), legacy.messages.length);
      const index: SessionsIndex = {
        version: 1,
        activeId: legacy.conversationId,
        order: [legacy.conversationId],
        sessions: { [legacy.conversationId]: meta },
      };
      // Persist the legacy body under its new key and clear the old key.
      if (!this.writeSessionBodyFile(legacy.conversationId, legacy)) {
        void this.ctx.workspaceState.update(this.bodyKey(legacy.conversationId), legacy);
      }
      void this.ctx.workspaceState.update(LEGACY_STATE_KEY, undefined);
      void this.ctx.workspaceState.update(SESSIONS_INDEX_KEY, index);
      return index;
    }
    // Fresh install: seed one empty active session.
    const fresh: SessionsIndex = { version: 1, activeId: "", order: [], sessions: {} };
    this.seedSessionInPlace(fresh);
    return fresh;
  }

  private seedSessionInPlace(index: SessionsIndex): SessionMeta {
    const id = randomUUID();
    const meta = this.makeMeta(id, "", 0);
    index.sessions[id] = meta;
    index.order = [id, ...index.order.filter((x) => x !== id)];
    index.activeId = id;
    return meta;
  }

  private makeMeta(id: string, title: string, messageCount: number): SessionMeta {
    const now = Date.now();
    return {
      conversationId: id,
      title,
      createdAt: now,
      updatedAt: now,
      messageCount,
      state: "active",
      pinned: false,
    };
  }

  private bodyKey(id: string): string {
    return SESSION_BODY_PREFIX + id;
  }

  private loadSessionBody(id: string): ConversationState {
    const fileBody = this.readSessionBodyFile(id);
    if (fileBody) {
      return fileBody;
    }
    const migrated = normalizeStoredConversationState(this.ctx.workspaceState.get<unknown>(this.bodyKey(id)), id);
    if (migrated) {
      if (this.writeSessionBodyFile(id, migrated)) {
        void this.ctx.workspaceState.update(this.bodyKey(id), undefined);
      }
      return migrated;
    }
    return {
      conversationId: id,
      messages: [],
      llmMessages: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  private migrateWorkspaceStateBodyToFile(id: string) {
    if (this.readSessionBodyFile(id)) {
      void this.ctx.workspaceState.update(this.bodyKey(id), undefined);
      return;
    }
    const migrated = normalizeStoredConversationState(this.ctx.workspaceState.get<unknown>(this.bodyKey(id)), id);
    if (migrated) {
      if (this.writeSessionBodyFile(id, migrated)) {
        void this.ctx.workspaceState.update(this.bodyKey(id), undefined);
      }
    }
  }

  private clearLegacySessionBodiesFromWorkspaceState() {
    for (const id of legacySessionBodyIds(this.ctx.workspaceState.keys(), SESSION_BODY_PREFIX)) {
      const key = this.bodyKey(id);
      const migrated = normalizeStoredConversationState(this.ctx.workspaceState.get<unknown>(key), id);
      if (migrated) {
        if (this.writeSessionBodyFile(id, migrated)) {
          void this.ctx.workspaceState.update(key, undefined);
        }
      } else {
        void this.ctx.workspaceState.update(key, undefined);
      }
    }
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
    try {
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
        this.persistTimer = undefined;
      }
      this.ensureStateShape();
      // Update meta from current state.
      const meta = this.sessions.sessions[this.state.conversationId];
      if (meta) {
        meta.updatedAt = Date.now();
        meta.messageCount = this.state.messages.length;
        if (!meta.title) {
          const derived = deriveTitleFromMessages(this.state.messages);
          if (derived) {
            meta.title = derived;
          }
        }
      }
      const wroteBodyFile = this.writeSessionBodyFile(this.state.conversationId, this.state);
      void Promise.all([
        this.ctx.workspaceState.update(this.bodyKey(this.state.conversationId), wroteBodyFile ? undefined : this.state),
        this.ctx.workspaceState.update(SESSIONS_INDEX_KEY, this.sessions),
        this.ctx.workspaceState.update(AUTO_APPROVE_KEY, this.autoApprove),
        this.ctx.workspaceState.update(ALWAYS_ALLOW_KEY, this.alwaysAllow),
        this.ctx.workspaceState.update(MODE_KEY, this.currentModeId),
      ]);
    } catch (e: unknown) {
      this.persistTimer = undefined;
      this.log(`persist failed: ${e instanceof Error ? e.message : String(e)}`);
      this.repairStateShape();
    }
  }

  private ensureStateShape() {
    if (!this.state || typeof this.state !== "object") {
      this.state = this.emptyState();
    }
    if (!this.state.conversationId) {
      this.state.conversationId = this.sessions?.activeId || randomUUID();
    }
    if (!Array.isArray(this.state.messages)) {
      this.state.messages = [];
      this.assistantIndex = null;
    }
    if (!Array.isArray(this.state.llmMessages)) {
      this.state.llmMessages = [];
    }
    if (!this.state.usage || typeof this.state.usage !== "object") {
      this.state.usage = { inputTokens: 0, outputTokens: 0 };
    }
    if (!this.sessions || typeof this.sessions !== "object") {
      this.sessions = { version: 1, activeId: this.state.conversationId, order: [], sessions: {} };
    }
    if (!this.sessions.sessions || typeof this.sessions.sessions !== "object") {
      this.sessions.sessions = {};
    }
    if (!Array.isArray(this.sessions.order)) {
      this.sessions.order = Object.keys(this.sessions.sessions);
    }
    if (!this.sessions.sessions[this.state.conversationId]) {
      this.sessions.sessions[this.state.conversationId] = this.makeMeta(
        this.state.conversationId,
        deriveTitleFromMessages(this.state.messages),
        this.state.messages.length,
      );
    }
    if (!this.sessions.activeId || !this.sessions.sessions[this.sessions.activeId]) {
      this.sessions.activeId = this.state.conversationId;
    }
    if (!this.sessions.order.includes(this.state.conversationId)) {
      this.sessions.order = [this.state.conversationId, ...this.sessions.order];
    }
  }

  private repairStateShape() {
    const id = this.state?.conversationId || this.sessions?.activeId || randomUUID();
    const messages = Array.isArray(this.state?.messages) ? this.state.messages : [];
    const llmMessages = Array.isArray(this.state?.llmMessages) ? this.state.llmMessages : [];
    const usage = this.state?.usage && typeof this.state.usage === "object"
      ? this.state.usage
      : { inputTokens: 0, outputTokens: 0 };
    this.state = {
      conversationId: id,
      messages,
      llmMessages,
      usage,
      lastInputTokens: this.state?.lastInputTokens,
      lastOutputTokens: this.state?.lastOutputTokens,
    };
    this.sessions = {
      version: 1,
      activeId: id,
      order: [id],
      sessions: {
        [id]: this.makeMeta(id, deriveTitleFromMessages(messages), messages.length),
      },
    };
    this.assistantIndex = null;
  }

  private sessionBodyFile(id: string): string | undefined {
    const root = this.ctx.storageUri?.fsPath;
    if (!root) {
      return undefined;
    }
    return path.join(root, "sessions", sessionBodyFileName(id));
  }

  private readSessionBodyFile(id: string): ConversationState | undefined {
    const file = this.sessionBodyFile(id);
    if (!file) {
      return undefined;
    }
    try {
      if (!fs.existsSync(file)) {
        return undefined;
      }
      return normalizeStoredConversationState(JSON.parse(fs.readFileSync(file, "utf8")), id);
    } catch (e: unknown) {
      this.log(`read session body failed for ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return undefined;
  }

  private writeSessionBodyFile(id: string, body: ConversationState): boolean {
    const file = this.sessionBodyFile(id);
    if (!file) {
      return false;
    }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(body), "utf8");
      return true;
    } catch (e: unknown) {
      this.log(`write session body failed for ${id}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  private deleteSessionBodyFile(id: string) {
    const file = this.sessionBodyFile(id);
    if (!file) {
      return;
    }
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (e: unknown) {
      this.log(`delete session body failed for ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
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
    this.post({ type: "autoApprove", config: this.autoApprove }, false);
  }

  private toggleAutoApproveCategory(category: AutoApproveCategory, enabled: boolean) {
    if (this.autoApprove.categories[category] === enabled) return;
    this.autoApprove = {
      enabled: this.autoApprove.enabled || enabled,
      categories: { ...this.autoApprove.categories, [category]: enabled },
    };
    this.schedulePersist();
    this.postAutoApprove();
  }

  private postAlwaysAllowList() {
    this.post({ type: "alwaysAllowList", rules: this.alwaysAllow }, false);
  }

  private getModes(): ModeDefinition[] {
    const userModes = vscode.workspace.getConfiguration("loom").get<ModeDefinition[]>("modes", []);
    return mergeModes(BUILTIN_MODES, Array.isArray(userModes) ? userModes : []);
  }

  private validModeId(modeId: string | undefined): modeId is string {
    return typeof modeId === "string" && this.getModes().some((mode) => mode.id === modeId);
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

  private async openPlanPreview(markdown: string) {
    try {
      const doc = await vscode.workspace.openTextDocument({
        language: "markdown",
        content: markdown,
      });
      await vscode.commands.executeCommand("markdown.showPreviewToSide", doc.uri);
    } catch (e: unknown) {
      this.post({ type: "error", error: `Could not open plan preview: ${e instanceof Error ? e.message : String(e)}` });
    }
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
      await this.postFirstRunState();
      return;
    }
    try {
      await this.agent?.updateConfig(cfg);
      await this.postLlmConfig();
      await this.postFirstRunState();
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

  public notifyFilesInvalidated(paths: string[]) {
    if (!this.agent || paths.length === 0) {
      return;
    }
    const workspaceRoot = this.workspaceRoot();
    const rel = paths
      .map((p) => {
        if (!workspaceRoot) return undefined;
        const r = path.relative(workspaceRoot, p);
        return r.startsWith("..") ? undefined : r.split(path.sep).join("/");
      })
      .filter((r): r is string => !!r);
    if (rel.length === 0) {
      return;
    }
    void this.agent.invalidateIndex(rel).catch(() => { /* ignore */ });
  }

  public async dispose() {
    if (this.activeTaskId) {
      try {
        await this.agent?.cancel(this.activeTaskId);
      } catch {
        // Best-effort cancellation during extension shutdown/update.
      }
      this.post({ type: "done", reason: "cancelled" });
      this.activeTaskId = undefined;
      this.activeTaskModeId = undefined;
      this.busy = false;
    }
    this.pendingApprovals.clear();
    this.pendingApprovalCalls.clear();
    this.cancelPendingQuestions();
    this.sessionBulkCounters.clear();
    this.toolStartTimes.clear();
    this.toolCallTasks.clear();
    this.activeToolCalls.clear();
    this.activeSubAgents.clear();
    this.activeProgressKeys.clear();
    this.queuedReferences = undefined;
    this.persistNow();
    await this.agent?.dispose();
    this.agent = undefined;
  }

  private async approveLocalToolBatch(
    params: ToolApproveBatchParams,
    workspaceRoot: string,
  ): Promise<ToolApproveBatchResult> {
    const taskId = params.taskId;
    const decisions: Record<string, "approved" | "rejected"> = {};
    // Fan each item through the existing single-call approval flow. Items
    // covered by host policy (autoApprove / alwaysAllow / session counters)
    // resolve immediately; others show the existing per-tool approval card.
    // The host-policy and UI dialog logic is shared with single-call flow,
    // so behavior is consistent regardless of how the loop dispatches.
    void workspaceRoot;
    await Promise.all(
      params.items.map(async (item) => {
        const call: ToolCall = {
          callId: item.callId,
          taskId,
          name: item.name,
          input: item.input,
          requiresApproval: true,
        };
        try {
          const { approved } = await this.approveLocalTool(call);
          decisions[item.callId] = approved ? "approved" : "rejected";
        } catch {
          decisions[item.callId] = "rejected";
        }
      }),
    );
    return { decisions };
  }

  private async approveLocalTool(call: ToolCall): Promise<{ approved: boolean }> {
    this.toolStartTimes.set(call.callId, Date.now());
    if (this.isApprovedByHostPolicy(call)) {
      this.routeToolCall({ ...call, requiresApproval: false });
      return { approved: true };
    }

    this.routeToolCall(call);
    const approved = await new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(call.callId, resolve);
      this.pendingApprovalCalls.set(call.callId, call);
    });
    if (!approved) {
      this.routeToolResult({ callId: call.callId, ok: false, error: "rejected" });
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
    const llmConfig = await this.currentLlmConfigView();
    this.post({ type: "llmConfig", llmConfig }, false);
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
    this.log(
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

  private log(line: string) {
    this.output.appendLine(line.trimEnd());
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

function updateQuestion(
  messages: Msg[],
  callId: string,
  update: (question: Extract<Msg, { role: "question" }>) => Msg,
) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const question = messages[i];
    if (question.role === "question" && question.callId === callId) {
      messages[i] = update(question) as Msg;
      break;
    }
  }
}

function updateSubAgent(
  messages: Msg[],
  subTaskId: string,
  update: (subAgent: Extract<Msg, { role: "subagent" }>) => Msg,
) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "subagent" && msg.subTaskId === subTaskId) {
      messages[i] = update(msg) as Msg;
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

function activeModeLabel(modeId: string, modes: ModeDefinition[]): string {
  return modes.find((mode) => mode.id === modeId)?.label ?? modeId;
}

function toolProgressDetail(call: ToolCall): string {
  const input = (call.input && typeof call.input === "object") ? call.input as Record<string, unknown> : {};
  const value = firstToolString(input, ["path", "query", "command", "task", "processId", "severity"]);
  const suffix = value ? ` ${trimProgressDetail(value)}` : "";
  switch (call.name) {
    case "read_file": return `Reading${suffix}.`;
    case "list_dir": return `Listing${suffix}.`;
    case "search": return `Searching${suffix}.`;
    case "find_symbol": return `Finding symbol${suffix}.`;
    case "find_references": return `Finding references${suffix}.`;
    case "semantic_search": return `Searching semantically${suffix}.`;
    case "get_diagnostics": return `Checking diagnostics${suffix}.`;
    case "load_skill": return `Loading skill guidance${suffix}.`;
    case "apply_diff": return call.requiresApproval ? `Waiting to apply changes${suffix}.` : `Applying changes${suffix}.`;
    case "run_command": return call.requiresApproval ? `Waiting to run command${suffix}.` : `Running command${suffix}.`;
    case "run_command_background": return call.requiresApproval ? `Waiting to start process${suffix}.` : `Starting process${suffix}.`;
    case "read_process_output": return `Reading process output${suffix}.`;
    case "kill_process": return call.requiresApproval ? `Waiting to stop process${suffix}.` : `Stopping process${suffix}.`;
    case "spawn_subagent": return `Starting research${suffix}.`;
    default: return `Using ${call.name}${suffix}.`;
  }
}

function toolResultProgressDetail(call: ToolCall): string | undefined {
  const input = (call.input && typeof call.input === "object") ? call.input as Record<string, unknown> : {};
  const value = firstToolString(input, ["path", "query", "command", "task", "processId", "severity"]);
  const suffix = value ? ` ${trimProgressDetail(value)}` : "";
  switch (call.name) {
    case "read_file": return `Read${suffix}; continuing with that context.`;
    case "list_dir": return `Listed${suffix}; checking the relevant entries.`;
    case "search": return `Search finished${suffix}; reviewing the matches.`;
    case "find_symbol": return `Found symbol results${suffix}; checking the implementation.`;
    case "find_references": return `Found references${suffix}; checking how they connect.`;
    case "semantic_search": return `Semantic search finished${suffix}; reviewing the best matches.`;
    case "get_diagnostics": return `Diagnostics checked${suffix}; deciding the next step.`;
    case "load_skill": return `Loaded skill guidance${suffix}; applying it to the task.`;
    case "apply_diff": return `Applied changes${suffix}; checking the result.`;
    case "run_command": return `Command finished${suffix}; reviewing the output.`;
    case "run_command_background": return `Process started${suffix}; continuing with its output when needed.`;
    case "read_process_output": return `Read process output${suffix}; checking what it shows.`;
    case "kill_process": return `Stopped process${suffix}; continuing.`;
    case "spawn_subagent": return `Research finished${suffix}; folding the findings back in.`;
    default: return `Finished ${call.name}${suffix}; continuing.`;
  }
}

function toolNoun(call: ToolCall): string {
  switch (call.name) {
    case "read_file": return "File read";
    case "list_dir": return "Directory listing";
    case "search":
    case "semantic_search": return "Search";
    case "apply_diff": return "Change";
    case "run_command":
    case "run_command_background": return "Command";
    case "spawn_subagent": return "Research";
    default: return call.name;
  }
}

function firstToolString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function trimProgressDetail(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
}

function deriveTitleFromMessages(messages: Msg[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser || firstUser.role !== "user") return "";
  return firstLine(firstUser.text, MAX_TITLE_LEN);
}

function firstLine(text: string, max: number): string {
  const line = text.trim().split(/\r?\n/, 1)[0] ?? "";
  if (line.length <= max) return line;
  return line.slice(0, max - 1).trimEnd() + "…";
}
