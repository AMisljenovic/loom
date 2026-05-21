import { useEffect, useRef, useState } from "react";
import { DEFAULT_AUTO_APPROVE_CONFIG } from "../../src/approval/categories";
import { detectModeSwitchIntent } from "../../src/shared/modeIntent";
import type {
  AlwaysAllowRule,
  AutoApproveConfig,
  CommandCatalogueEntry,
  CommandInvocation,
  ConversationUsage,
  FirstRunState,
  IndexStatusNotify,
  LlmConfigView,
  McpServerStatus,
  ModeDefinition,
  Msg,
  ProcessSnapshot,
  ReferenceAttachment,
  ReferencePacksIndex,
  SessionSearchHit,
  SessionsIndex,
  ToolApprovalItem,
  TodoItem,
  ToolStatus,
} from "../../src/shared/protocol";
import { mergeReferenceAttachments, normalizeReferenceAttachments } from "../../src/shared/references";
import { expandCommandBody } from "../../src/commands/expand";
import { AutoApprovePopover } from "./components/AutoApprovePopover";
import { EmptyState } from "./components/EmptyState";
import { FirstRun } from "./components/FirstRun";
import { PanelHeader } from "./components/PanelHeader";
import { SettingsView } from "./components/SettingsView";
import { InputArea, type LiveTaskStatus } from "./components/composer/InputArea";
import { ConversationList } from "./components/conversations/ConversationList";
import { AllowlistPopover } from "./components/popovers/AllowlistPopover";
import { ModelPopover } from "./components/popovers/ModelPopover";
import { McpPanel } from "./components/McpPanel";
import { PlanHandoff } from "./components/PlanHandoff";
import { SearchPanel } from "./components/SearchPanel";
import { Thread } from "./components/thread/Thread";
import { Toolbar } from "./components/toolbar/Toolbar";
import { post } from "./vscode";

const defaultLlmConfig: LlmConfigView = {
  provider: "anthropic",
  model: "claude-opus-4-7",
  hasApiKey: false,
  apiKeys: { anthropic: false, openai: false },
};

const SLASH_PRESETS: Record<string, { mode: string; prefix: string }> = {
  "/explain": { mode: "ask", prefix: "Explain: " },
  "/test": { mode: "code", prefix: "Write tests for: " },
  "/refactor": { mode: "code", prefix: "Refactor: " },
};

function updateTool(
  msgs: Msg[],
  callId: string,
  fn: (m: Extract<Msg, { role: "tool" }>) => Extract<Msg, { role: "tool" }>
): Msg[] {
  return msgs.map((m) =>
    m.role === "tool" && m.callId === callId ? fn(m) : m
  );
}

function updateQuestion(
  msgs: Msg[],
  callId: string,
  fn: (m: Extract<Msg, { role: "question" }>) => Extract<Msg, { role: "question" }>
): Msg[] {
  return msgs.map((m) =>
    m.role === "question" && m.callId === callId ? fn(m) : m
  );
}

function updateSubAgent(
  msgs: Msg[],
  subTaskId: string,
  fn: (m: Extract<Msg, { role: "subagent" }>) => Extract<Msg, { role: "subagent" }>
): Msg[] {
  return msgs.map((m) =>
    m.role === "subagent" && m.subTaskId === subTaskId ? fn(m) : m
  );
}

export function toggleToolExpanded(msgs: Msg[], callId: string): Msg[] {
  let changed = false;
  const toggle = (tool: Extract<Msg, { role: "tool" }>): Extract<Msg, { role: "tool" }> => {
    changed = true;
    return { ...tool, expanded: tool.expanded !== true };
  };

  const next = msgs.map((m) => {
    if (m.role === "tool" && m.callId === callId) {
      return toggle(m);
    }
    if (m.role !== "subagent") {
      return m;
    }

    let traceChanged = false;
    const trace = m.trace.map((traceMsg) => {
      if (traceMsg.role !== "tool" || traceMsg.callId !== callId) {
        return traceMsg;
      }
      traceChanged = true;
      return toggle(traceMsg);
    });

    return traceChanged ? { ...m, trace } : m;
  });

  return changed ? next : msgs;
}

export function upsertTodoMessage(
  msgs: Msg[],
  taskId: string,
  title: string | undefined,
  items: TodoItem[],
): Msg[] {
  const normalized = normalizeTodoItems(items);
  if (normalized.length === 0) return msgs;
  const idx = msgs.findIndex((m) => m.role === "todo" && m.taskId === taskId);
  const todoMsg: Extract<Msg, { role: "todo" }> = {
    role: "todo",
    taskId,
    title,
    items: normalized,
  };
  if (idx < 0) return [...msgs, todoMsg];
  const existing = msgs[idx] as Extract<Msg, { role: "todo" }>;
  const merged: Extract<Msg, { role: "todo" }> = {
    ...todoMsg,
    title: title || existing.title,
  };
  const next = msgs.slice();
  next.splice(idx, 1);
  next.push(merged);
  return next;
}

export function upsertStopMessage(msgs: Msg[], stop: Extract<Msg, { role: "stop" }>): Msg[] {
  if (!stop.taskId) return [...msgs, stop];
  const idx = msgs.findIndex((m) => m.role === "stop" && m.taskId === stop.taskId);
  if (idx < 0) return [...msgs, stop];
  const next = [...msgs];
  next[idx] = stop;
  return next;
}

export function taskStopMessage(input: {
  taskId?: string;
  reason: Extract<Msg, { role: "stop" }>["reason"];
  error?: string;
  durationMs?: number;
  maxTurns?: number;
  toolCounts?: Record<string, number>;
  duplicateToolCalls?: number;
}): Extract<Msg, { role: "stop" }> {
  const elapsed = formatDuration(input.durationMs);
  const suffix = elapsed ? ` after ${elapsed}` : "";
  const baseContinue = "Continue from where you stopped. Keep using the existing context, plan, and todos.";
  if (input.reason === "turn_limit") {
    const limit = input.maxTurns ? `${input.maxTurns} model/tool turns` : "the model/tool turn limit";
    return {
      role: "stop",
      taskId: input.taskId,
      title: "Stopped at turn limit",
      text: input.error || `Loom reached ${limit}${suffix}. Continue to keep working from this conversation state.`,
      reason: input.reason,
      durationMs: input.durationMs,
      canContinue: true,
      continuePrompt: baseContinue,
      maxTurns: input.maxTurns,
      toolCounts: input.toolCounts,
      duplicateToolCalls: input.duplicateToolCalls,
    };
  }
  if (input.reason === "cancelled") {
    return {
      role: "stop",
      taskId: input.taskId,
      title: "Task cancelled",
      text: `This task was cancelled${suffix}. Continue when you want Loom to resume from the current conversation state.`,
      reason: input.reason,
      durationMs: input.durationMs,
      canContinue: true,
      continuePrompt: baseContinue,
      toolCounts: input.toolCounts,
      duplicateToolCalls: input.duplicateToolCalls,
    };
  }
  return {
    role: "stop",
    taskId: input.taskId,
    title: "Task stopped",
    text: input.error || "Loom stopped this turn unexpectedly. Check the extension Output channel for details.",
    reason: input.reason,
    durationMs: input.durationMs,
    canContinue: true,
    continuePrompt: baseContinue,
    toolCounts: input.toolCounts,
    duplicateToolCalls: input.duplicateToolCalls,
  };
}

function formatDuration(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function normalizeTodoItems(items: TodoItem[]): TodoItem[] {
  return items
    .map((item, index) => ({
      id: item.id?.trim() || `todo-${index + 1}`,
      text: item.text.trim(),
      status: item.status === "in_progress" || item.status === "done" || item.status === "cancelled"
        ? item.status
        : "pending",
    }))
    .filter((item) => item.text);
}

function mergeToolOutput(existing: string | undefined, summary: string): string {
  if (!existing) return summary;
  if (existing.includes(summary)) return existing;
  return existing;
}

function deriveLiveTaskStatus(messages: Msg[], busy: boolean): LiveTaskStatus | null {
  if (!busy) return null;

  const subagent = [...messages]
    .reverse()
    .find((m): m is Extract<Msg, { role: "subagent" }> => m.role === "subagent" && m.status === "running");
  if (subagent) {
    return {
      phase: "researching",
      label: "Researching",
      detail: trimDetail(subagent.task),
    };
  }

  const activeTool = [...messages]
    .reverse()
    .find((m): m is Extract<Msg, { role: "tool" }> => (
      m.role === "tool" &&
      (m.status === "pending" || m.status === "approved" || m.status === "running")
    ));

  if (activeTool) {
    if (activeTool.status === "pending") {
      return {
        phase: "waiting",
        label: "Waiting for approval",
        detail: toolDetail(activeTool),
      };
    }
    if (activeTool.name === "apply_diff") {
      return {
        phase: "changing",
        label: "Changing files",
        detail: toolDetail(activeTool),
      };
    }
    if (activeTool.name === "run_command" || activeTool.name === "run_command_background" || activeTool.name === "kill_process" || activeTool.name === "read_process_output") {
      return {
        phase: "executing",
        label: activeTool.name === "read_process_output" ? "Reading process output" : "Executing command",
        detail: toolDetail(activeTool),
      };
    }
    if (activeTool.name === "spawn_subagent") {
      return {
        phase: "researching",
        label: "Starting research",
        detail: toolDetail(activeTool),
      };
    }
    return {
      phase: "reading",
      label: "Reading workspace",
      detail: toolDetail(activeTool),
    };
  }

  const activeQuestion = [...messages]
    .reverse()
    .find((m): m is Extract<Msg, { role: "question" }> => m.role === "question" && m.status === "pending");
  if (activeQuestion) {
    return {
      phase: "waiting",
      label: "Waiting for answers",
      detail: activeQuestion.title || "Clarifying questions",
    };
  }

  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && last.text.trim()) {
    return {
      phase: "responding",
      label: "Writing response",
      detail: "Preparing the answer",
    };
  }

  return {
    phase: "thinking",
    label: "Thinking",
    detail: "Planning the next step",
  };
}

function toolDetail(tool: Extract<Msg, { role: "tool" }>): string | undefined {
  if (!tool.input || typeof tool.input !== "object") return tool.name;
  const input = tool.input as Record<string, unknown>;
  const value = firstString(input, ["path", "command", "query", "processId", "task", "severity"]);
  return value ? trimDetail(value) : tool.name;
}

function firstString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function trimDetail(value: string): string {
  return value.length > 90 ? `${value.slice(0, 87)}...` : value;
}

export function removeApprovalBatchItem(
  batch: { batchId: string; items: ToolApprovalItem[] } | null,
  callId: string,
): { batchId: string; items: ToolApprovalItem[] } | null {
  if (!batch) return null;
  const items = batch.items.filter((item) => item.callId !== callId);
  return items.length > 0 ? { ...batch, items } : null;
}

export function buildApprovalBatchDecisions(
  items: ToolApprovalItem[],
  decision: "approved" | "rejected",
): Record<string, "approved" | "rejected"> {
  return Object.fromEntries(items.map((item) => [item.callId, decision] as const));
}

function prettyToolInput(input: unknown): string {
  if (input == null) return "(no args)";
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function matchImportedCommand(prompt: string, commands: CommandCatalogueEntry[]): { command: CommandCatalogueEntry; args: string } | undefined {
  if (!prompt.startsWith("/")) return undefined;
  const withoutSlash = prompt.slice(1);
  const space = withoutSlash.search(/\s/);
  const name = space < 0 ? withoutSlash : withoutSlash.slice(0, space);
  if (!name) return undefined;
  const command = commands.find((item) => item.name === name);
  if (!command) return undefined;
  return { command, args: space < 0 ? "" : withoutSlash.slice(space).trimStart() };
}

function formatProcessBytes(totalBytes: number): string {
  if (totalBytes < 1024) return `${totalBytes} B`;
  if (totalBytes < 1024 * 1024) return `${(totalBytes / 1024).toFixed(1)} KB`;
  return `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatProcessAge(startedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// Auto-prune exited processes from the UI 30s after exit. The host keeps logs
// around for 5 minutes (RETAIN_AFTER_EXIT_MS) for inspection; the UI hides
// rows sooner so the panel doesn't accumulate stale entries with unresponsive
// buttons.
const PROCESS_HIDE_AFTER_EXIT_MS = 30 * 1000;

function ProcessesPanel({
  processes,
  onOpen,
  onKill,
  onClearCompleted,
}: {
  processes: ProcessSnapshot[];
  onOpen: (id: string) => void;
  onKill: (id: string) => void;
  onClearCompleted: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const hasStale = processes.some((p) => !p.running && typeof p.exitedAt === "number");
  useEffect(() => {
    if (!hasStale) return;
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, [hasStale]);
  const visible = processes.filter((p) => {
    if (p.running) return true;
    if (typeof p.exitedAt !== "number") return true;
    return now - p.exitedAt < PROCESS_HIDE_AFTER_EXIT_MS;
  });
  const completedCount = processes.filter((p) => !p.running).length;
  return (
    <div className="convo-list workflow-panel">
      <div className="convo-list-head">
        <span>Processes</span>
        {completedCount > 0 && (
          <button
            className="btn btn-sm"
            onClick={onClearCompleted}
            title="Dismiss all exited processes"
          >
            Clear completed
          </button>
        )}
      </div>
      {visible.length === 0 ? (
        <div className="workflow-empty">No background processes yet.</div>
      ) : visible.map((proc) => (
        <div className="workflow-row" key={proc.processId}>
          <div className="workflow-main">
            <div className="workflow-title">{proc.command}</div>
            <div className="workflow-meta">
              <span>{proc.running ? "running" : `exit ${proc.exitCode ?? "?"}`}</span>
              <span>{formatProcessBytes(proc.totalBytes)}</span>
              <span>{formatProcessAge(proc.startedAt)}</span>
            </div>
            {proc.tailOutput && <pre className="workflow-preview">{proc.tailOutput}</pre>}
          </div>
          <div className="workflow-actions">
            <button className="btn btn-sm" onClick={() => onOpen(proc.processId)}>Open</button>
            <button className="btn btn-sm" onClick={() => onKill(proc.processId)} disabled={!proc.running}>Stop</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<ConversationUsage>({ inputTokens: 0, outputTokens: 0 });
  const [llmConfig, setLlmConfig] = useState<LlmConfigView>(defaultLlmConfig);
  const [firstRun, setFirstRun] = useState<FirstRunState | null>(null);
  const [autoApprove, setAutoApprove] = useState<AutoApproveConfig>(() => ({
    ...DEFAULT_AUTO_APPROVE_CONFIG,
    categories: { ...DEFAULT_AUTO_APPROVE_CONFIG.categories },
  }));
  const [showAutoApprove, setShowAutoApprove] = useState(false);
  const [alwaysAllowRules, setAlwaysAllowRules] = useState<AlwaysAllowRule[]>([]);
  const [processes, setProcesses] = useState<ProcessSnapshot[]>([]);
  const [approvalBatch, setApprovalBatch] = useState<{ batchId: string; items: ToolApprovalItem[] } | null>(null);
  const [pendingDiffs, setPendingDiffs] = useState<Map<string, string>>(() => new Map());
  const [pendingOutputs, setPendingOutputs] = useState<Map<string, string>>(() => new Map());
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
  const [indexStatus, setIndexStatus] = useState<IndexStatusNotify | null>(null);
  const [sessions, setSessions] = useState<SessionsIndex | null>(null);
  const [commands, setCommands] = useState<CommandCatalogueEntry[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [showAllowlist, setShowAllowlist] = useState(false);
  const [showModel, setShowModel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProcesses, setShowProcesses] = useState(false);
  const [showApprovalCenter, setShowApprovalCenter] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [modes, setModes] = useState<ModeDefinition[]>([]);
  const [currentModeId, setCurrentModeId] = useState<string>("code");
  const [notice, setNotice] = useState<string | null>(null);
  const [planHandoffArmed, setPlanHandoffArmed] = useState(false);
  const [planHandoffMarkdown, setPlanHandoffMarkdown] = useState<string>("");
  const [threadPinSignal, setThreadPinSignal] = useState(0);
  const [references, setReferences] = useState<ReferenceAttachment[]>([]);
  const [referencePacks, setReferencePacks] = useState<ReferencePacksIndex>({ version: 1, order: [], packs: {} });
  const [sessionSearchHits, setSessionSearchHits] = useState<SessionSearchHit[]>([]);
  const [workspaceFolders, setWorkspaceFolders] = useState<Array<{ uri: string; name: string }>>([]);
  const [activeWorkspaceFolderUri, setActiveWorkspaceFolderUri] = useState<string>("");

  const rootRef = useRef<HTMLDivElement>(null);
  const assistantRef = useRef<number | null>(null);
  const interruptQueuedRef = useRef(false);
  const deltaBufferRef = useRef("");
  const deltaFrameRef = useRef<number | null>(null);
  const subagentDeltaBuffersRef = useRef<Map<string, string>>(new Map());
  const subagentDeltaFrameRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const announce = (text: string) => {
    setNotice(text);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3200);
  };

  useEffect(() => {
    post({ type: "ready" });
    const flushDelta = () => {
      const text = deltaBufferRef.current;
      if (!text) return;
      deltaBufferRef.current = "";
      deltaFrameRef.current = null;
      setMessages((prev) => {
        let next = [...prev];
        if (assistantRef.current === null) {
          next.push({ role: "assistant", text });
          assistantRef.current = next.length - 1;
        } else {
          const cur = next[assistantRef.current] as Msg & { role: "assistant" };
          next[assistantRef.current] = { ...cur, text: cur.text + text };
        }
        return next;
      });
    };
    const queueDelta = (text: string) => {
      deltaBufferRef.current += text;
      if (deltaFrameRef.current === null) {
        deltaFrameRef.current = window.requestAnimationFrame(flushDelta);
      }
    };
    const flushSubagentDeltas = () => {
      const buffers = subagentDeltaBuffersRef.current;
      if (buffers.size === 0) {
        subagentDeltaFrameRef.current = null;
        return;
      }
      subagentDeltaBuffersRef.current = new Map();
      subagentDeltaFrameRef.current = null;
      setMessages((prev) => {
        let next = prev;
        buffers.forEach((text, subTaskId) => {
          next = updateSubAgent(next, subTaskId, (sub) => {
            const trace = [...sub.trace];
            const last = trace[trace.length - 1];
            if (last?.role === "assistant") {
              trace[trace.length - 1] = { ...last, text: last.text + text };
            } else {
              trace.push({ role: "assistant", text });
            }
            return { ...sub, trace };
          });
        });
        return next;
      });
    };
    const queueSubagentDelta = (subTaskId: string, text: string) => {
      const buffers = subagentDeltaBuffersRef.current;
      buffers.set(subTaskId, (buffers.get(subTaskId) ?? "") + text);
      if (subagentDeltaFrameRef.current === null) {
        subagentDeltaFrameRef.current = window.requestAnimationFrame(flushSubagentDeltas);
      }
    };
    const handler = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "themeConfig") {
        const root = rootRef.current;
        if (!root) return;
        if (m.accent) root.dataset.accent = m.accent;
        if (m.density) root.dataset.density = m.density;
        if (m.themeBias && m.themeBias !== "auto") root.dataset.theme = m.themeBias;
        return;
      }
      if (m.type === "restore") {
        setMessages(m.messages ?? []);
        setUsage(m.usage ?? { inputTokens: 0, outputTokens: 0 });
        setLlmConfig(m.llmConfig ?? defaultLlmConfig);
        setPendingDiffs(new Map());
        setPendingOutputs(new Map());
        setMcpStatuses([]);
        setApprovalBatch(null);
        setProcesses([]);
        setBusy(false);
        assistantRef.current = null;
        interruptQueuedRef.current = false;
        deltaBufferRef.current = "";
        if (deltaFrameRef.current !== null) {
          window.cancelAnimationFrame(deltaFrameRef.current);
          deltaFrameRef.current = null;
        }
        subagentDeltaBuffersRef.current = new Map();
        if (subagentDeltaFrameRef.current !== null) {
          window.cancelAnimationFrame(subagentDeltaFrameRef.current);
          subagentDeltaFrameRef.current = null;
        }
        return;
      }
      if (m.type === "llmConfig") { setLlmConfig(m.llmConfig ?? defaultLlmConfig); return; }
      if (m.type === "firstRunState") { setFirstRun(m.state ?? null); return; }
      if (m.type === "usage") { setUsage(m.usage); return; }
      if (m.type === "autoApprove") { if (m.config) setAutoApprove(m.config); return; }
      if (m.type === "alwaysAllowList") { setAlwaysAllowRules(Array.isArray(m.rules) ? m.rules : []); return; }
      if (m.type === "modes") {
        setModes(Array.isArray(m.modes) ? m.modes : []);
        setCurrentModeId(typeof m.currentModeId === "string" ? m.currentModeId : "code");
        return;
      }
      if (m.type === "modeAutoChanged") {
        setCurrentModeId(typeof m.modeId === "string" ? m.modeId : "code");
        announce(`Switched to ${m.label ?? m.modeId} mode${m.prompt ? " for this task" : ""}.`);
        return;
      }
      if (m.type === "diffPreview") {
        setPendingDiffs((prev) => { const next = new Map(prev); next.set(m.callId, m.unified); return next; });
        return;
      }
      if (m.type === "mcpStatus") {
        setMcpStatuses((prev) => {
          const updated = prev.filter((s) => s.server !== m.status.server);
          return [...updated, m.status];
        });
        return;
      }
      if (m.type === "indexStatus") { setIndexStatus(m.status); return; }
      if (m.type === "processesSnapshot") { setProcesses(Array.isArray(m.processes) ? m.processes : []); return; }
      if (m.type === "approvalBatchRequest") {
        setApprovalBatch({ batchId: m.batchId, items: Array.isArray(m.items) ? m.items : [] });
        setShowApprovalCenter(true);
        return;
      }
      if (m.type === "sessions") { setSessions(m.index); return; }
      if (m.type === "referencePacks") { setReferencePacks(m.index); return; }
      if (m.type === "commandsCatalogue") { setCommands(Array.isArray(m.commands) ? m.commands : []); return; }
      if (m.type === "sessionSearchResults") { setSessionSearchHits(Array.isArray(m.hits) ? m.hits : []); return; }
      if (m.type === "workspaceFolders") {
        setWorkspaceFolders(Array.isArray(m.folders) ? m.folders : []);
        setActiveWorkspaceFolderUri(typeof m.activeUri === "string" ? m.activeUri : "");
        return;
      }
      if (m.type === "referencesPicked") { setReferences(normalizeReferenceAttachments(m.references)); return; }
      if (m.type === "referencePickError") { announce(m.error || "Could not add references."); return; }
      if (m.type === "toolProgress") {
        setPendingOutputs((po) => { const np = new Map(po); np.set(m.callId, (po.get(m.callId) ?? "") + m.chunk); return np; });
      }
      if (m.type === "toolResult") {
        setPendingDiffs((prev) => { if (!prev.has(m.callId)) return prev; const next = new Map(prev); next.delete(m.callId); return next; });
        setPendingOutputs((prev) => { if (!prev.has(m.callId)) return prev; const next = new Map(prev); next.delete(m.callId); return next; });
      }
      if (m.type === "subagentToolResult") {
        setPendingDiffs((prev) => { if (!prev.has(m.callId)) return prev; const next = new Map(prev); next.delete(m.callId); return next; });
        setPendingOutputs((prev) => { if (!prev.has(m.callId)) return prev; const next = new Map(prev); next.delete(m.callId); return next; });
      }
      if (m.type === "subagentToolProgress") {
        setPendingOutputs((po) => { const np = new Map(po); np.set(m.callId, (po.get(m.callId) ?? "") + m.chunk); return np; });
      }
      if (m.type === "delta") {
        queueDelta(m.text);
        return;
      }
      if (m.type === "subagentDelta") {
        queueSubagentDelta(m.subTaskId, m.text);
        return;
      }
      flushDelta();
      flushSubagentDeltas();
      // Anything that interrupts the assistant text stream closes the
      // in-progress assistant bubble so subsequent deltas open a fresh
      // intent line instead of being appended to the previous chunk.
      if (
        m.type === "toolCall" ||
        m.type === "todoUpdate" ||
        m.type === "subagentSpawn" ||
        m.type === "questionRequest" ||
        m.type === "progress"
      ) {
        assistantRef.current = null;
      }
      if ((m.type === "done" && m.reason === "completed") || m.type === "planReady") {
        setThreadPinSignal((value) => value + 1);
      }
      setMessages((prev) => {
        let next = [...prev];
        if (m.type === "progress") {
          next.push({ role: "progress", phase: m.phase, text: m.text, createdAt: m.createdAt });
        } else if (m.type === "toolCall") {
          next.push({ role: "tool", name: m.call.name, status: m.call.requiresApproval ? "pending" : "approved", callId: m.call.callId, input: m.call.input, expanded: m.call.requiresApproval });
        } else if (m.type === "todoUpdate") {
          return upsertTodoMessage(next, m.taskId, m.title, m.items ?? []);
        } else if (m.type === "questionRequest") {
          next.push({ role: "question", callId: m.callId, title: m.request?.title, questions: m.request?.questions ?? [], status: "pending" });
        } else if (m.type === "questionAnswered") {
          return updateQuestion(next, m.callId, (question) => ({ ...question, status: "answered", answers: m.answers }));
        } else if (m.type === "toolProgress") {
          return updateTool(next, m.callId, (tool) => ({ ...tool, status: tool.status === "approved" ? "running" : tool.status }));
        } else if (m.type === "toolResult") {
          return updateTool(next, m.callId, (tool) => {
            const finalOutput = mergeToolOutput(tool.output, m.summary);
            const status: ToolStatus = !m.ok && m.summary === "rejected" ? "rejected" : m.ok ? "done" : "error";
            return { ...tool, status, output: tool.output ? finalOutput : m.summary, durationMs: m.durationMs };
          });
        } else if (m.type === "subagentSpawn") {
          next.push({
            role: "subagent",
            parentTaskId: m.parentTaskId,
            subTaskId: m.subTaskId,
            type: m.subagentType,
            task: m.task,
            status: "running",
            trace: [{ role: "user", text: m.task }],
            expanded: false,
          });
        } else if (m.type === "subagentToolCall") {
          return updateSubAgent(next, m.subTaskId, (sub) => ({
            ...sub,
            trace: [...sub.trace, { role: "tool", name: m.call.name, status: m.call.requiresApproval ? "pending" : "approved", callId: m.call.callId, input: m.call.input, expanded: m.call.requiresApproval }],
          }));
        } else if (m.type === "subagentToolProgress") {
          return updateSubAgent(next, m.subTaskId, (sub) => ({
            ...sub,
            trace: updateTool(sub.trace, m.callId, (tool) => ({ ...tool, status: tool.status === "approved" ? "running" : tool.status })),
          }));
        } else if (m.type === "subagentToolResult") {
          return updateSubAgent(next, m.subTaskId, (sub) => ({
            ...sub,
            trace: updateTool(sub.trace, m.callId, (tool) => {
              const finalOutput = mergeToolOutput(tool.output, m.summary);
              const status: ToolStatus = !m.ok && m.summary === "rejected" ? "rejected" : m.ok ? "done" : "error";
              return { ...tool, status, output: tool.output ? finalOutput : m.summary, durationMs: m.durationMs };
            }),
          }));
        } else if (m.type === "subagentDone") {
          return updateSubAgent(next, m.subTaskId, (sub) => ({
            ...sub,
            status: m.status,
            summary: m.summary,
            toolCalls: m.toolCalls,
            tokensUsed: m.tokensUsed,
            inputTokens: m.inputTokens,
            outputTokens: m.outputTokens,
            truncated: m.truncated,
          }));
        } else if (m.type === "done") {
          if (m.reason !== "completed") {
            for (let i = 0; i < next.length; i++) {
              const item = next[i];
              if (item.role === "question" && item.status === "pending") {
                next[i] = { ...item, status: "cancelled" };
              }
            }
          }
          if (m.reason === "cancelled" && assistantRef.current !== null) {
            const cur = next[assistantRef.current];
            if (cur?.role === "assistant" && cur.text && !cur.text.endsWith(" [interrupted]")) {
              next[assistantRef.current] = { ...cur, text: `${cur.text} [interrupted]` };
            }
          }
          if (m.reason === "completed") {
            // Promote the last non-empty assistant message to a summary
            // card. Intermediate inter-tool prose stays as intent lines.
            // If the model finished without producing any assistant text
            // since the last user turn, surface a placeholder so the
            // transcript isn't silent.
            let promoted = false;
            for (let i = next.length - 1; i >= 0; i--) {
              const item = next[i];
              if (item.role === "user") break;
              if (item.role === "assistant" && item.text.trim()) {
                next[i] = { ...item, kind: "summary" };
                promoted = true;
                break;
              }
            }
            if (!promoted) {
              next.push({
                role: "assistant",
                text: "Loom finished this turn without producing a response.",
                kind: "error",
              });
            }
          } else {
            next = upsertStopMessage(next, taskStopMessage({
              taskId: typeof m.taskId === "string" ? m.taskId : undefined,
              reason: m.reason,
              error: typeof m.error === "string" ? m.error : undefined,
              durationMs: typeof m.durationMs === "number" ? m.durationMs : undefined,
              maxTurns: typeof m.maxTurns === "number" ? m.maxTurns : undefined,
              toolCounts: m.toolCounts,
              duplicateToolCalls: typeof m.duplicateToolCalls === "number" ? m.duplicateToolCalls : undefined,
            }));
          }
          const keepBusy = m.reason === "cancelled" && interruptQueuedRef.current;
          interruptQueuedRef.current = false;
          setBusy(keepBusy);
          assistantRef.current = null;
        } else if (m.type === "planReady") {
          setPlanHandoffArmed(true);
          setPlanHandoffMarkdown(typeof m.markdown === "string" ? m.markdown : "");
        } else if (m.type === "summarized") {
          next.push({ role: "assistant", text: `Context summarized (${m.droppedCount} older messages compacted).` });
        } else if (m.type === "error") {
          next.push({ role: "assistant", text: m.error || "Unknown error.", kind: "error" });
          assistantRef.current = null;
          interruptQueuedRef.current = false;
          setBusy(false);
        }
        return next;
      });
    };
    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
      if (deltaFrameRef.current !== null) {
        window.cancelAnimationFrame(deltaFrameRef.current);
      }
      if (subagentDeltaFrameRef.current !== null) {
        window.cancelAnimationFrame(subagentDeltaFrameRef.current);
      }
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const submit = () => {
    let prompt = input.trim();
    const submitReferences = normalizeReferenceAttachments(references);
    if (!prompt && submitReferences.length === 0) return;
    let submitModeId: string | undefined;
    let command: CommandInvocation | undefined;
    const importedCommand = matchImportedCommand(prompt, commands);
    if (importedCommand) {
      prompt = expandCommandBody(importedCommand.command.body, importedCommand.args).trim();
      command = { name: importedCommand.command.name, source: importedCommand.command.source };
    } else {
      for (const [slash, preset] of Object.entries(SLASH_PRESETS)) {
        if (prompt === slash || prompt.startsWith(slash + " ")) {
          const modeId = preset.mode;
          prompt = preset.prefix + prompt.slice(slash.length).trimStart();
          setCurrentModeId(modeId);
          post({ type: "setMode", modeId });
          submitModeId = modeId;
          break;
        }
      }
    }
    const modeIntent = detectModeSwitchIntent(prompt, modes);
    if (modeIntent) {
      setCurrentModeId(modeIntent.modeId);
      post({ type: "setMode", modeId: modeIntent.modeId });
      submitModeId = modeIntent.modeId;
      announce(`Switched to ${modeIntent.label} mode${modeIntent.prompt ? " for this task" : ""}.`);
      if (!modeIntent.prompt) {
        setInput("");
        return;
      }
      prompt = modeIntent.prompt;
    }
    setMessages((m) => [...m, { role: "user", text: prompt, references: submitReferences, command }]);
    setShowSessions(false);
    // Any new user turn dismisses the previous plan-handoff CTA.
    setPlanHandoffArmed(false);
    if (busy) {
      interruptQueuedRef.current = true;
      post({ type: "cancel" });
      post({ type: "submit", prompt, modeId: submitModeId, references: submitReferences, command });
    } else {
      post({ type: "submit", prompt, modeId: submitModeId, references: submitReferences, command });
      setBusy(true);
    }
    setInput("");
    setReferences([]);
  };

  const implementPlan = (prompt: string, todos?: TodoItem[]) => {
    setPlanHandoffArmed(false);
    setCurrentModeId("code");
    post({ type: "setMode", modeId: "code" });
    setMessages((m) => [...m, { role: "user", text: prompt }]);
    setShowSessions(false);
    post({
      type: "submit",
      prompt,
      modeId: "code",
      seedTodos: todos && todos.length > 0 ? { title: "Implementation Todos", items: todos } : undefined,
    });
    setBusy(true);
  };

  const continueStoppedTask = (prompt: string, nextMaxTurns?: number) => {
    if (busy) return;
    const nextPrompt = prompt.trim() || "Continue from where you stopped.";
    setMessages((m) => [...m, { role: "user", text: nextPrompt }]);
    setShowSessions(false);
    setPlanHandoffArmed(false);
    post({
      type: "submit",
      prompt: nextPrompt,
      modeId: currentModeId,
      maxTurns: nextMaxTurns,
    });
    setBusy(true);
  };

  const handleSingleBatchDecision = (callId: string, decision: "approved" | "rejected") => {
    post({ type: "approve", callId, approved: decision === "approved" });
    setApprovalBatch((prev) => removeApprovalBatchItem(prev, callId));
  };

  const handleBatchDecision = (decision: "approved" | "rejected") => {
    if (!approvalBatch) return;
    post({
      type: "approveBatch",
      batchId: approvalBatch.batchId,
      decisions: buildApprovalBatchDecisions(approvalBatch.items, decision),
    });
    setApprovalBatch(null);
  };

  const toggleToolExpandedForCall = (callId: string) => {
    setMessages((m) => toggleToolExpanded(m, callId));
  };

  const currentMode = modes.find((m) => m.id === currentModeId);
  const isEmpty = messages.length === 0;
  const showFirstRun = isEmpty && firstRun && (!firstRun.completed || firstRun.needsSetup);
  const liveStatus = deriveLiveTaskStatus(messages, busy);
  const hasPendingQuestion = !busy && messages.some((m) => m.role === "question" && m.status === "pending");
  const processCount = processes.length;
  const approvalCount = approvalBatch?.items.length ?? 0;

  return (
    <div className="panel" ref={rootRef}>
      <PanelHeader
        busy={busy}
        sessionsOpen={showSessions}
        processCount={processCount}
        approvalCount={approvalCount}
        onToggleSessions={() => {
          setShowModel(false);
          setShowAllowlist(false);
          setShowProcesses(false);
          setShowApprovalCenter(false);
          setShowSessions((v) => !v);
        }}
        onToggleProcesses={() => {
          setShowSessions(false);
          setShowModel(false);
          setShowAllowlist(false);
          setShowApprovalCenter(false);
          setShowProcesses((v) => !v);
        }}
        onToggleApprovals={() => {
          setShowSessions(false);
          setShowModel(false);
          setShowAllowlist(false);
          setShowProcesses(false);
          setShowApprovalCenter((v) => !v);
        }}
        onSetup={() => {
          setShowAllowlist(false);
          setShowSessions(false);
          setShowProcesses(false);
          setShowApprovalCenter(false);
          setShowModel((v) => !v);
        }}
      />
      {showSessions && (
        <ConversationList
          index={sessions}
          showArchived={showArchived}
          onToggleArchived={() => setShowArchived((v) => !v)}
          renamingId={renamingId}
          onBeginRename={(id) => setRenamingId(id)}
          onEndRename={() => setRenamingId(null)}
          onNewConversation={() => {
            post({ type: "newConversation" });
            setShowSessions(false);
            setShowArchived(false);
            setRenamingId(null);
          }}
          onSessionPicked={() => {
            setShowSessions(false);
            setRenamingId(null);
          }}
          searchResults={sessionSearchHits}
          onSearch={(q) => post({ type: "sessionSearch", query: q })}
        />
      )}
      {showProcesses && (
        <ProcessesPanel
          processes={processes}
          onOpen={(id) => post({ type: "processOpenOutput", processId: id })}
          onKill={(id) => post({ type: "processKill", processId: id })}
          onClearCompleted={() => post({ type: "processesClearCompleted" })}
        />
      )}
      {showMcp && (
        <McpPanel statuses={mcpStatuses} onClose={() => setShowMcp(false)} />
      )}
      {showSearch && (
        <SearchPanel onClose={() => setShowSearch(false)} />
      )}
      {showApprovalCenter && (
        <div className="convo-list workflow-panel">
          <div className="convo-list-head">
            <span>Approval center</span>
          </div>
          {!approvalBatch || approvalBatch.items.length === 0 ? (
            <div className="workflow-empty">No grouped approvals waiting.</div>
          ) : (
            <>
              {approvalBatch.items.map((item) => (
                <div className="workflow-row" key={item.callId}>
                  <div className="workflow-main">
                    <div className="workflow-title">{item.name}</div>
                    <pre className="workflow-preview">{prettyToolInput(item.input)}</pre>
                  </div>
                  <div className="workflow-actions">
                    <button className="btn btn-sm" onClick={() => handleSingleBatchDecision(item.callId, "approved")}>Approve</button>
                    <button className="btn btn-sm" onClick={() => handleSingleBatchDecision(item.callId, "rejected")}>Reject</button>
                  </div>
                </div>
              ))}
              <div className="workflow-actions bulk-actions">
                <button className="btn btn-primary btn-sm" onClick={() => handleBatchDecision("approved")}>Approve all</button>
                <button className="btn btn-sm" onClick={() => handleBatchDecision("rejected")}>Reject all</button>
              </div>
            </>
          )}
        </div>
      )}
      {notice && <div className="notice-toast" role="status">{notice}</div>}
      {showSettings ? (
        <SettingsView config={llmConfig} onClose={() => setShowSettings(false)} />
      ) : showFirstRun ? (
        <FirstRun state={firstRun} onSample={(p) => setInput(p)} />
      ) : isEmpty ? (
        <EmptyState mode={currentMode} onSuggest={(p) => { setInput(p); }} />
      ) : (
        <Thread
          messages={messages}
          pendingDiffs={pendingDiffs}
          pendingOutputs={pendingOutputs}
          busy={busy}
          onToggleToolExpanded={toggleToolExpandedForCall}
          onContinue={continueStoppedTask}
          conversationId={sessions?.activeId}
          pinSignal={threadPinSignal}
        />
      )}
      {planHandoffArmed && !busy && (
        <PlanHandoff
          markdown={planHandoffMarkdown}
          onImplement={implementPlan}
          onDismiss={() => setPlanHandoffArmed(false)}
        />
      )}
      <InputArea
        busy={busy}
        input={input}
        onInput={setInput}
        onSubmit={submit}
        status={liveStatus}
        references={references}
        packs={referencePacks}
        commands={commands}
        onAddReference={() => post({ type: "pickReferences", existing: references })}
        onRemoveReference={(id) => setReferences((prev) => prev.filter((ref) => ref.id !== id))}
        onDirectReference={(ref) => setReferences((prev) => mergeReferenceAttachments(normalizeReferenceAttachments(prev), [ref]))}
        onSavePack={(name) => post({ type: "packSave", name, refs: references })}
        onApplyPack={(id, mode) => post({ type: "packApply", id, mode })}
        onDeletePack={(id) => post({ type: "packDelete", id })}
        onRenamePack={(id, name) => post({ type: "packRename", id, name })}
        disabled={hasPendingQuestion}
        hint={hasPendingQuestion ? "Answer the question above to continue" : undefined}
      />
      <div className="toolbar-shell">
        <Toolbar
          llmConfig={llmConfig}
          usage={usage}
          mcpStatuses={mcpStatuses}
          indexStatus={indexStatus}
          modes={modes}
          currentModeId={currentModeId}
          alwaysAllowRules={alwaysAllowRules}
          autoApprove={autoApprove}
          workspaceFolders={workspaceFolders}
          activeWorkspaceFolderUri={activeWorkspaceFolderUri}
          onShowAllowlist={() => { post({ type: "requestAlwaysAllowList" }); setShowAllowlist(true); }}
          onShowModel={() => setShowModel((v) => !v)}
          onShowAutoApprove={() => setShowAutoApprove((v) => !v)}
          onShowMcp={() => {
            setShowSearch(false);
            setShowProcesses(false);
            setShowApprovalCenter(false);
            setShowSessions(false);
            setShowMcp((v) => !v);
          }}
          onShowSearch={() => {
            setShowMcp(false);
            setShowProcesses(false);
            setShowApprovalCenter(false);
            setShowSessions(false);
            setShowSearch((v) => !v);
          }}
        />
        {showAllowlist && <AllowlistPopover rules={alwaysAllowRules} onClose={() => setShowAllowlist(false)} />}
        {showModel && (
          <ModelPopover
            config={llmConfig}
            onClose={() => setShowModel(false)}
            onOpenSettings={() => {
              setShowModel(false);
              setShowSettings(true);
            }}
          />
        )}
        {showAutoApprove && <AutoApprovePopover config={autoApprove} onClose={() => setShowAutoApprove(false)} />}
      </div>
    </div>
  );
}
