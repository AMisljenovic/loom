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
  SessionsIndex,
  ToolStatus,
} from "../../src/shared/protocol";
import { AutoApprovePopover } from "./components/AutoApprovePopover";
import { EmptyState } from "./components/EmptyState";
import { FirstRun } from "./components/FirstRun";
import { PanelHeader } from "./components/PanelHeader";
import { InputArea } from "./components/composer/InputArea";
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

function mergeToolOutput(existing: string | undefined, summary: string): string {
  if (!existing) return summary;
  if (existing.includes(summary)) return existing;
  return existing;
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
  const [showArchived, setShowArchived] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [showAllowlist, setShowAllowlist] = useState(false);
  const [showModel, setShowModel] = useState(false);
  const [modes, setModes] = useState<ModeDefinition[]>([]);
  const [currentModeId, setCurrentModeId] = useState<string>("code");
  const [notice, setNotice] = useState<string | null>(null);
  // Mode the most recent task ran under; used to surface an "Implement plan"
  // hand-off button when an Architect-mode plan finishes cleanly.
  const [lastTaskModeId, setLastTaskModeId] = useState<string | null>(null);
  const [planHandoffArmed, setPlanHandoffArmed] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const assistantRef = useRef<number | null>(null);
  const interruptQueuedRef = useRef(false);
  const deltaBufferRef = useRef("");
  const deltaFrameRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  // Mirrors lastTaskModeId so the message-handler closure (mounted once)
  // can read the most recent value without re-subscribing.
  const lastTaskModeIdRef = useRef<string | null>(null);
  useEffect(() => { lastTaskModeIdRef.current = lastTaskModeId; }, [lastTaskModeId]);

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
      if (m.type === "toolProgress") {
        setPendingOutputs((po) => { const np = new Map(po); np.set(m.callId, (po.get(m.callId) ?? "") + m.chunk); return np; });
      }
      if (m.type === "toolResult") {
        setPendingDiffs((prev) => { if (!prev.has(m.callId)) return prev; const next = new Map(prev); next.delete(m.callId); return next; });
        setPendingOutputs((prev) => { if (!prev.has(m.callId)) return prev; const next = new Map(prev); next.delete(m.callId); return next; });
      }
      if (m.type === "delta") {
        queueDelta(m.text);
        return;
      }
      flushDelta();
      setMessages((prev) => {
        const next = [...prev];
        if (m.type === "toolCall") {
          next.push({ role: "tool", name: m.call.name, status: m.call.requiresApproval ? "pending" : "approved", callId: m.call.callId, input: m.call.input, expanded: false });
        } else if (m.type === "toolProgress") {
          return updateTool(next, m.callId, (tool) => ({ ...tool, status: tool.status === "approved" ? "running" : tool.status, expanded: tool.expanded ?? true }));
        } else if (m.type === "toolResult") {
          return updateTool(next, m.callId, (tool) => {
            const finalOutput = mergeToolOutput(tool.output, m.summary);
            const status: ToolStatus = !m.ok && m.summary === "rejected" ? "rejected" : m.ok ? "done" : "error";
            return { ...tool, status, output: tool.output ? finalOutput : m.summary, durationMs: m.durationMs };
          });
        } else if (m.type === "done") {
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
          if (!keepBusy && m.reason === "completed") {
            setPlanHandoffArmed((prev) => prev || lastTaskModeIdRef.current === "architect");
          }
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
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const submit = () => {
    let prompt = input.trim();
    if (!prompt) return;
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
    setMessages((m) => [...m, { role: "user", text: prompt }]);
    // Any new user turn dismisses the previous plan-handoff CTA.
    setPlanHandoffArmed(false);
    setLastTaskModeId(submitModeId ?? currentModeId);
    if (busy) {
      interruptQueuedRef.current = true;
      post({ type: "cancel" });
      post({ type: "submit", prompt, modeId: submitModeId });
    } else {
      post({ type: "submit", prompt, modeId: submitModeId });
      setBusy(true);
    }
    setInput("");
  };

  const implementPlan = () => {
    setPlanHandoffArmed(false);
    setCurrentModeId("code");
    post({ type: "setMode", modeId: "code" });
    const prompt = "Implement the plan above.";
    setMessages((m) => [...m, { role: "user", text: prompt }]);
    setLastTaskModeId("code");
    post({ type: "submit", prompt, modeId: "code" });
    setBusy(true);
  };

  const currentMode = modes.find((m) => m.id === currentModeId);
  const isEmpty = messages.length === 0;
  const showFirstRun = isEmpty && firstRun && (!firstRun.completed || firstRun.needsSetup);

  return (
    <div className="panel" ref={rootRef}>
      <PanelHeader
        busy={busy}
        onSetup={() => {
          setShowAllowlist(false);
          setShowModel((v) => !v);
        }}
      />
      <ConversationList
        index={sessions}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived((v) => !v)}
        renamingId={renamingId}
        onBeginRename={(id) => setRenamingId(id)}
        onEndRename={() => setRenamingId(null)}
      />
      {notice && <div className="notice-toast" role="status">{notice}</div>}
      {showFirstRun ? (
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
      <InputArea busy={busy} input={input} onInput={setInput} onSubmit={submit} />
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
        {showModel && <ModelPopover config={llmConfig} onClose={() => setShowModel(false)} />}
        {showAutoApprove && <AutoApprovePopover config={autoApprove} onClose={() => setShowAutoApprove(false)} />}
      </div>
    </div>
  );
}
