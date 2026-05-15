import React, { useEffect, useRef, useState } from "react";
import type {
  ConversationUsage,
  LlmConfigView,
  LlmProvider,
  Msg,
  ReasoningEffort,
  ToolStatus,
} from "../../src/shared/protocol";
import { estimateCost } from "../../src/shared/pricing";

// VS Code webview API handle
declare function acquireVsCodeApi(): { postMessage: (m: unknown) => void };
const vscode = acquireVsCodeApi();

const defaultLlmConfig: LlmConfigView = {
  provider: "anthropic",
  model: "claude-opus-4-7",
  hasApiKey: false,
  apiKeys: { anthropic: false, openai: false },
};

const providerLabels: Record<LlmProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  local: "Local",
};

const modelOptions: Record<Exclude<LlmProvider, "local">, string[]> = {
  anthropic: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-5", "gpt-4o", "o3-mini"],
};

export function App() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<ConversationUsage>({ inputTokens: 0, outputTokens: 0 });
  const [llmConfig, setLlmConfig] = useState<LlmConfigView>(defaultLlmConfig);
  const assistantRef = useRef<number | null>(null);
  const interruptQueuedRef = useRef(false);

  useEffect(() => {
    vscode.postMessage({ type: "ready" });
    const handler = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "restore") {
        setMessages(m.messages ?? []);
        setUsage(m.usage ?? { inputTokens: 0, outputTokens: 0 });
        setLlmConfig(m.llmConfig ?? defaultLlmConfig);
        setBusy(false);
        assistantRef.current = null;
        interruptQueuedRef.current = false;
        return;
      }
      if (m.type === "llmConfig") {
        setLlmConfig(m.llmConfig ?? defaultLlmConfig);
        return;
      }
      if (m.type === "usage") {
        setUsage(m.usage);
        return;
      }
      setMessages((prev) => {
        const next = [...prev];
        if (m.type === "delta") {
          if (assistantRef.current === null) {
            next.push({ role: "assistant", text: m.text });
            assistantRef.current = next.length - 1;
          } else {
            const cur = next[assistantRef.current] as Msg & { role: "assistant" };
            next[assistantRef.current] = { ...cur, text: cur.text + m.text };
          }
        } else if (m.type === "toolCall") {
          next.push({
            role: "tool",
            name: m.call.name,
            status: m.call.requiresApproval ? "pending" : "approved",
            callId: m.call.callId,
            input: m.call.input,
            expanded: false,
          });
        } else if (m.type === "toolProgress") {
          updateTool(next, m.callId, (tool) => ({
            ...tool,
            status: tool.status === "approved" ? "running" : tool.status,
            output: `${tool.output ?? ""}${m.chunk}`,
            expanded: tool.expanded ?? true,
          }));
        } else if (m.type === "toolResult") {
          updateTool(next, m.callId, (tool) => {
            const hasOutput = Boolean(tool.output);
            const finalOutput = mergeToolOutput(tool.output, m.summary);
            const status: ToolStatus = !m.ok && m.summary === "rejected" ? "rejected" : m.ok ? "done" : "error";
            return {
              ...tool,
              status,
              output: hasOutput ? finalOutput : m.summary,
              durationMs: m.durationMs,
            };
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
        } else if (m.type === "summarized") {
          next.push({
            role: "assistant",
            text: `Context summarized (${m.droppedCount} older messages compacted).`,
          });
        } else if (m.type === "error") {
          next.push({ role: "assistant", text: `Error: ${m.error}` });
          interruptQueuedRef.current = false;
          setBusy(false);
        }
        return next;
      });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const submit = () => {
    const prompt = input.trim();
    if (!prompt) return;
    setMessages((m) => [...m, { role: "user", text: prompt }]);
    if (busy) {
      interruptQueuedRef.current = true;
      vscode.postMessage({ type: "cancel" });
      vscode.postMessage({ type: "submit", prompt });
    } else {
      vscode.postMessage({ type: "submit", prompt });
      setBusy(true);
    }
    setInput("");
  };

  const newConversation = () => {
    if (busy) return;
    vscode.postMessage({ type: "newConversation" });
  };

  const approve = (callId: string, approved: boolean) => {
    vscode.postMessage({ type: "approve", callId, approved });
    setMessages((prev) =>
      prev.map((m) =>
        m.role === "tool" && m.callId === callId
          ? { ...m, status: approved ? "approved" : "rejected" }
          : m
      )
    );
  };

  const toggleTool = (callId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.role === "tool" && m.callId === callId
          ? { ...m, expanded: !m.expanded }
          : m
      )
    );
  };

  return (
    <div style={styles.shell}>
      <div style={styles.toolbar}>
        <button onClick={newConversation} disabled={busy} style={styles.secondaryButton}>New conversation</button>
      </div>
      <div style={styles.transcript}>
        {messages.map((m, i) => (
          <div key={i} style={styles.message}>
            {m.role === "user" && <div><strong>You:</strong> {m.text}</div>}
            {m.role === "assistant" && <div><strong>Agent:</strong> {m.text}</div>}
            {m.role === "tool" && (
              <ToolCard
                msg={m}
                onApprove={approve}
                onToggle={toggleTool}
              />
            )}
          </div>
        ))}
      </div>
      <StatusStrip usage={usage} llmConfig={llmConfig} />
      <div style={styles.composer}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Ask the agent..."
          style={styles.input}
        />
        <button onClick={submit} disabled={!input.trim()} style={styles.send}>Send</button>
      </div>
    </div>
  );
}

function StatusStrip({ usage, llmConfig }: { usage: ConversationUsage; llmConfig: LlmConfigView }) {
  const cost = estimateCost(usage);
  return (
    <div style={styles.statusStrip}>
      <ProviderPicker config={llmConfig} />
      <span>↑ {formatTokens(usage.inputTokens)}</span>
      <span>↓ {formatTokens(usage.outputTokens)}</span>
      {cost !== undefined && <span>≈ ${cost.toFixed(cost < 0.01 ? 4 : 2)}</span>}
    </div>
  );
}

function ProviderPicker({ config }: { config: LlmConfigView }) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<LlmProvider>(config.provider);
  const [model, setModel] = useState(config.model);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl ?? "");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(config.reasoningEffort ?? "");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    setProvider(config.provider);
    setModel(config.model);
    setBaseUrl(config.baseUrl ?? (config.provider === "local" ? "http://localhost:11434/v1" : ""));
    setReasoningEffort(config.reasoningEffort ?? "");
    setApiKey("");
  }, [config]);

  const hasKey = provider === "local"
    ? true
    : config.apiKeys?.[provider] ?? (config.provider === provider ? Boolean(config.hasApiKey) : false);
  const showKey = provider !== "local" && !hasKey;
  const listedModels = provider === "local" ? [] : modelOptions[provider];
  const customModel = provider !== "local" && !listedModels.includes(model);

  const changeProvider = (nextProvider: LlmProvider) => {
    setProvider(nextProvider);
    setModel(defaultModelFor(nextProvider));
    setBaseUrl(nextProvider === "local" ? "http://localhost:11434/v1" : "");
    setReasoningEffort("");
    setApiKey("");
  };

  const apply = () => {
    const finalModel = model.trim() || defaultModelFor(provider);
    if (showKey && apiKey.trim()) {
      vscode.postMessage({ type: "setSecret", provider, apiKey: apiKey.trim() });
    }
    vscode.postMessage({
      type: "setLlmConfig",
      config: {
        provider,
        model: finalModel,
        baseUrl: provider === "local" || provider === "openai" ? baseUrl.trim() : undefined,
        reasoningEffort: provider === "openai" ? reasoningEffort : undefined,
      },
    });
    setOpen(false);
    setApiKey("");
  };

  return (
    <div style={styles.providerPicker}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={styles.providerPill}>
        {providerLabels[config.provider]} / {config.model}
      </button>
      {open && (
        <div style={styles.providerPanel}>
          <label style={styles.fieldLabel}>
            Provider
            <select
              value={provider}
              onChange={(e) => changeProvider(e.target.value as LlmProvider)}
              style={styles.field}
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="local">Local</option>
            </select>
          </label>
          {provider === "local" ? (
            <label style={styles.fieldLabel}>
              Model
              <input value={model} onChange={(e) => setModel(e.target.value)} style={styles.field} />
            </label>
          ) : (
            <>
              <label style={styles.fieldLabel}>
                Model
                <select
                  value={customModel ? "__custom__" : model}
                  onChange={(e) => setModel(e.target.value === "__custom__" ? "" : e.target.value)}
                  style={styles.field}
                >
                  {listedModels.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                  <option value="__custom__">Custom...</option>
                </select>
              </label>
              {customModel && (
                <label style={styles.fieldLabel}>
                  Custom model
                  <input value={model} onChange={(e) => setModel(e.target.value)} style={styles.field} />
                </label>
              )}
            </>
          )}
          {(provider === "local" || provider === "openai") && (
            <label style={styles.fieldLabel}>
              Base URL
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={provider === "local" ? "http://localhost:11434/v1" : ""}
                style={styles.field}
              />
            </label>
          )}
          {provider === "openai" && (
            <label style={styles.fieldLabel}>
              Reasoning effort
              <select
                value={reasoningEffort}
                onChange={(e) => setReasoningEffort(e.target.value as ReasoningEffort)}
                style={styles.field}
              >
                <option value="">Default</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          )}
          {showKey && (
            <label style={styles.fieldLabel}>
              API key
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                type="password"
                style={styles.field}
              />
            </label>
          )}
          <div style={styles.providerActions}>
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" onClick={apply}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolCard({
  msg,
  onApprove,
  onToggle,
}: {
  msg: Extract<Msg, { role: "tool" }>;
  onApprove: (callId: string, approved: boolean) => void;
  onToggle: (callId: string) => void;
}) {
  const outputRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (msg.status === "running" && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [msg.output, msg.status]);

  const duration = msg.durationMs === undefined ? "" : ` · ${formatDuration(msg.durationMs)}`;

  return (
    <div style={styles.toolCard}>
      <div
        role="button"
        tabIndex={0}
        style={styles.toolHeader}
        onClick={() => onToggle(msg.callId)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onToggle(msg.callId);
        }}
      >
        <span style={{
          ...styles.chevron,
          transform: msg.expanded ? "rotate(90deg)" : "rotate(0deg)",
        }}>
          ▶
        </span>
        <strong>{msg.name}</strong>
        <span style={styles.status}> · {msg.status}{duration}</span>
        {msg.status === "pending" && (
          <span style={styles.approvals}>
            <button onClick={(e) => { e.stopPropagation(); onApprove(msg.callId, true); }}>Approve</button>
            <button onClick={(e) => { e.stopPropagation(); onApprove(msg.callId, false); }}>Reject</button>
          </span>
        )}
      </div>
      {msg.expanded && (
        <div style={styles.toolBody}>
          <div style={styles.sectionLabel}>Input:</div>
          <pre style={styles.pre}>{JSON.stringify(msg.input ?? {}, null, 2)}</pre>
          <div style={styles.sectionLabel}>Output:</div>
          <pre ref={outputRef} style={styles.outputPre}>{msg.output ?? ""}</pre>
        </div>
      )}
    </div>
  );
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

function defaultModelFor(provider: LlmProvider): string {
  if (provider === "openai") return "gpt-5";
  if (provider === "local") return "llama3.1";
  return "claude-opus-4-7";
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    fontFamily: "var(--vscode-font-family)",
  },
  transcript: {
    flex: 1,
    overflowY: "auto",
    padding: 8,
  },
  toolbar: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 6,
    padding: "8px 8px 0",
  },
  secondaryButton: {
    font: "inherit",
  },
  message: {
    marginBottom: 12,
  },
  toolCard: {
    border: "1px solid var(--vscode-panel-border)",
    background: "var(--vscode-editor-background)",
  },
  toolHeader: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 4,
    border: 0,
    padding: "6px 8px",
    color: "var(--vscode-foreground)",
    background: "transparent",
    textAlign: "left",
    cursor: "pointer",
    font: "inherit",
  },
  chevron: {
    display: "inline-block",
    width: 14,
    transition: "transform 120ms ease",
  },
  status: {
    color: "var(--vscode-descriptionForeground)",
  },
  approvals: {
    marginLeft: "auto",
    display: "inline-flex",
    gap: 4,
  },
  toolBody: {
    borderTop: "1px solid var(--vscode-panel-border)",
    padding: 8,
  },
  sectionLabel: {
    color: "var(--vscode-descriptionForeground)",
    marginBottom: 4,
  },
  pre: {
    margin: "0 0 8px",
    padding: 8,
    overflow: "auto",
    maxHeight: 300,
    color: "var(--vscode-textPreformat-foreground)",
    background: "var(--vscode-editor-background)",
    border: "1px solid var(--vscode-panel-border)",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  outputPre: {
    margin: 0,
    padding: 8,
    overflow: "auto",
    maxHeight: 300,
    color: "var(--vscode-textPreformat-foreground)",
    background: "var(--vscode-editor-background)",
    border: "1px solid var(--vscode-panel-border)",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  composer: {
    display: "flex",
    padding: 8,
    borderTop: "1px solid var(--vscode-panel-border)",
  },
  statusStrip: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "4px 8px",
    color: "var(--vscode-descriptionForeground)",
    borderTop: "1px solid var(--vscode-panel-border)",
    fontSize: 12,
  },
  providerPicker: {
    position: "relative",
    marginRight: "auto",
  },
  providerPill: {
    border: "1px solid var(--vscode-button-border, var(--vscode-panel-border))",
    borderRadius: 999,
    padding: "2px 8px",
    color: "var(--vscode-button-foreground)",
    background: "var(--vscode-button-background)",
    font: "inherit",
    cursor: "pointer",
    maxWidth: 220,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  providerPanel: {
    position: "absolute",
    left: 0,
    bottom: "calc(100% + 6px)",
    zIndex: 10,
    width: 260,
    padding: 8,
    border: "1px solid var(--vscode-panel-border)",
    background: "var(--vscode-editor-background)",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.24)",
  },
  fieldLabel: {
    display: "grid",
    gap: 4,
    marginBottom: 8,
    color: "var(--vscode-foreground)",
  },
  field: {
    width: "100%",
    boxSizing: "border-box",
    color: "var(--vscode-input-foreground)",
    background: "var(--vscode-input-background)",
    border: "1px solid var(--vscode-input-border, var(--vscode-panel-border))",
    padding: "4px 6px",
    font: "inherit",
  },
  providerActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 6,
  },
  input: {
    flex: 1,
    padding: 4,
  },
  send: {
    marginLeft: 4,
  },
};
