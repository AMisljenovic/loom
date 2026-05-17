import { useEffect, useRef, useState } from "react";
import { DEFAULT_AUTO_APPROVE_CONFIG } from "../../src/approval/categories";
import { detectModeSwitchIntent } from "../../src/shared/modeIntent";
import type {
  AlwaysAllowRule,
  AutoApproveConfig,
  ConversationUsage,
  FirstRunState,
  IndexStatusNotify,
  LlmConfigView,
  McpServerStatus,
  ModeDefinition,
  Msg,
  ReferenceAttachment,
  SessionsIndex,
  ToolStatus,
} from "../../src/shared/protocol";
import { mergeReferenceAttachments, normalizeReferenceAttachments } from "../../src/shared/references";
import { AutoApprovePopover } from "./components/AutoApprovePopover";
import { EmptyState } from "./components/EmptyState";
import { FirstRun } from "./components/FirstRun";
import { PanelHeader } from "./components/PanelHeader";
import { SettingsView } from "./components/SettingsView";
import { InputArea, type LiveTaskStatus } from "./components/composer/InputArea";
import { ConversationList } from "./components/conversations/ConversationList";
import { AllowlistPopover } from "./components/popovers/AllowlistPopover";
import { ModelPopover } from "./components/popovers/ModelPopover";
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
  const [pendingDiffs, setPendingDiffs] = useState<Map<string, string>>(() => new Map());
  const [pendingOutputs, setPendingOutputs] = useState<Map<string, string>>(() => new Map());
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
  const [indexStatus, setIndexStatus] = useState<IndexStatusNotify | null>(null);
  const [sessions, setSessions] = useState<SessionsIndex | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [showAllowlist, setShowAllowlist] = useState(false);
  const [showModel, setShowModel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [modes, setModes] = useState<ModeDefinition[]>([]);
  const [currentModeId, setCurrentModeId] = useState<string>("code");
  const [notice, setNotice] = useState<string | null>(null);
  const [planHandoffArmed, setPlanHandoffArmed] = useState(false);
  const [references, setReferences] = useState<ReferenceAttachment[]>([]);

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
        const next = [...prev];
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
      if (m.type === "sessions") { setSessions(m.index); return; }
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
      setMessages((prev) => {
        const next = [...prev];
        if (m.type === "progress") {
          next.push({ role: "progress", phase: m.phase, text: m.text, createdAt: m.createdAt });
        } else if (m.type === "toolCall") {
          next.push({ role: "tool", name: m.call.name, status: m.call.requiresApproval ? "pending" : "approved", callId: m.call.callId, input: m.call.input, expanded: false });
        } else if (m.type === "questionRequest") {
          next.push({ role: "question", callId: m.callId, title: m.request?.title, questions: m.request?.questions ?? [], status: "pending" });
        } else if (m.type === "questionAnswered") {
          return updateQuestion(next, m.callId, (question) => ({ ...question, status: "answered", answers: m.answers }));
        } else if (m.type === "toolProgress") {
          return updateTool(next, m.callId, (tool) => ({ ...tool, status: tool.status === "approved" ? "running" : tool.status, expanded: tool.expanded ?? true }));
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
            trace: [...sub.trace, { role: "tool", name: m.call.name, status: m.call.requiresApproval ? "pending" : "approved", callId: m.call.callId, input: m.call.input, expanded: false }],
          }));
        } else if (m.type === "subagentToolProgress") {
          return updateSubAgent(next, m.subTaskId, (sub) => ({
            ...sub,
            trace: updateTool(sub.trace, m.callId, (tool) => ({ ...tool, status: tool.status === "approved" ? "running" : tool.status, expanded: tool.expanded ?? true })),
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
          const keepBusy = m.reason === "cancelled" && interruptQueuedRef.current;
          interruptQueuedRef.current = false;
          setBusy(keepBusy);
          assistantRef.current = null;
        } else if (m.type === "planReady") {
          setPlanHandoffArmed(true);
        } else if (m.type === "summarized") {
          next.push({ role: "assistant", text: `Context summarized (${m.droppedCount} older messages compacted).` });
        } else if (m.type === "error") {
          next.push({ role: "assistant", text: `Error: ${m.error}` });
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
    setMessages((m) => [...m, { role: "user", text: prompt, references: submitReferences }]);
    setShowSessions(false);
    // Any new user turn dismisses the previous plan-handoff CTA.
    setPlanHandoffArmed(false);
    if (busy) {
      interruptQueuedRef.current = true;
      post({ type: "cancel" });
      post({ type: "submit", prompt, modeId: submitModeId, references: submitReferences });
    } else {
      post({ type: "submit", prompt, modeId: submitModeId, references: submitReferences });
      setBusy(true);
    }
    setInput("");
    setReferences([]);
  };

  const implementPlan = () => {
    setPlanHandoffArmed(false);
    setCurrentModeId("code");
    post({ type: "setMode", modeId: "code" });
    const prompt = "Implement the plan above.";
    setMessages((m) => [...m, { role: "user", text: prompt }]);
    setShowSessions(false);
    post({ type: "submit", prompt, modeId: "code" });
    setBusy(true);
  };

  const currentMode = modes.find((m) => m.id === currentModeId);
  const isEmpty = messages.length === 0;
  const showFirstRun = isEmpty && firstRun && (!firstRun.completed || firstRun.needsSetup);
  const liveStatus = deriveLiveTaskStatus(messages, busy);
  const hasPendingQuestion = !busy && messages.some((m) => m.role === "question" && m.status === "pending");

  return (
    <div className="panel" ref={rootRef}>
      <PanelHeader
        busy={busy}
        sessionsOpen={showSessions}
        onToggleSessions={() => {
          setShowModel(false);
          setShowAllowlist(false);
          setShowSessions((v) => !v);
        }}
        onSetup={() => {
          setShowAllowlist(false);
          setShowSessions(false);
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
        />
      )}
      {notice && <div className="notice-toast" role="status">{notice}</div>}
      {showSettings ? (
        <SettingsView config={llmConfig} onClose={() => setShowSettings(false)} />
      ) : showFirstRun ? (
        <FirstRun state={firstRun} onSample={(p) => setInput(p)} />
      ) : isEmpty ? (
        <EmptyState mode={currentMode} onSuggest={(p) => { setInput(p); }} />
      ) : (
        <Thread messages={messages} pendingDiffs={pendingDiffs} pendingOutputs={pendingOutputs} busy={busy} />
      )}
      {planHandoffArmed && !busy && (
        <div className="plan-handoff">
          <span className="plan-handoff-label">Plan ready.</span>
          <button className="btn btn-primary" onClick={implementPlan}>
            Implement plan
          </button>
        </div>
      )}
      <InputArea
        busy={busy}
        input={input}
        onInput={setInput}
        onSubmit={submit}
        status={liveStatus}
        references={references}
        onAddReference={() => post({ type: "pickReferences", existing: references })}
        onRemoveReference={(id) => setReferences((prev) => prev.filter((ref) => ref.id !== id))}
        onDirectReference={(ref) => setReferences((prev) => mergeReferenceAttachments(normalizeReferenceAttachments(prev), [ref]))}
        disabled={hasPendingQuestion}
        hint={hasPendingQuestion ? "Answer the question above to continue" : undefined}
      />
      <div style={{ position: "relative" }}>
        <Toolbar
          llmConfig={llmConfig}
          usage={usage}
          mcpStatuses={mcpStatuses}
          indexStatus={indexStatus}
          modes={modes}
          currentModeId={currentModeId}
          alwaysAllowRules={alwaysAllowRules}
          autoApprove={autoApprove}
          onShowAllowlist={() => { post({ type: "requestAlwaysAllowList" }); setShowAllowlist(true); }}
          onShowModel={() => setShowModel((v) => !v)}
          onShowAutoApprove={() => setShowAutoApprove((v) => !v)}
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
