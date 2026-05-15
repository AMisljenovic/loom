import React, { useEffect, useRef, useState } from "react";
import { estimateCost } from "../../src/shared/pricing";
import type {
  AlwaysAllowRule,
  ConversationUsage,
  IndexStatusNotify,
  LlmConfigView,
  LlmProvider,
  McpServerStatus,
  ModeDefinition,
  Msg,
  ReasoningEffort,
  ToolStatus,
} from "../../src/shared/protocol";
import { InlineDiff } from "./components/InlineDiff";

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

interface ApproveOptions {
  rememberRule?: AlwaysAllowRule;
  sessionCount?: number;
}

export function App() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<ConversationUsage>({ inputTokens: 0, outputTokens: 0 });
  const [llmConfig, setLlmConfig] = useState<LlmConfigView>(defaultLlmConfig);
  const [autoApprove, setAutoApprove] = useState(false);
  const [alwaysAllowRules, setAlwaysAllowRules] = useState<AlwaysAllowRule[]>([]);
  const [pendingDiffs, setPendingDiffs] = useState<Map<string, string>>(() => new Map());
  const [mcpStatuses, setMcpStatuses] = useState<Record<string, McpServerStatus>>({});
  const [indexStatus, setIndexStatus] = useState<IndexStatusNotify | null>(null);
  const [showAlwaysAllow, setShowAlwaysAllow] = useState(false);
  const [modes, setModes] = useState<ModeDefinition[]>([]);
  const [currentModeId, setCurrentModeId] = useState<string>("code");
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
        setPendingDiffs(new Map());
        setMcpStatuses({});
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
      if (m.type === "autoApprove") {
        setAutoApprove(Boolean(m.enabled));
        return;
      }
      if (m.type === "alwaysAllowList") {
        setAlwaysAllowRules(Array.isArray(m.rules) ? m.rules : []);
        return;
      }
      if (m.type === "modes") {
        setModes(Array.isArray(m.modes) ? m.modes : []);
        setCurrentModeId(typeof m.currentModeId === "string" ? m.currentModeId : "code");
        return;
      }
      if (m.type === "diffPreview") {
        setPendingDiffs((prev) => {
          const next = new Map(prev);
          next.set(m.callId, m.unified);
          return next;
        });
        return;
      }
      if (m.type === "mcpStatus") {
        setMcpStatuses((prev) => ({ ...prev, [m.status.server]: m.status }));
        return;
      }
      if (m.type === "indexStatus") {
        setIndexStatus(m.status);
        return;
      }
      if (m.type === "toolResult") {
        setPendingDiffs((prev) => {
          if (!prev.has(m.callId)) return prev;
          const next = new Map(prev);
          next.delete(m.callId);
          return next;
        });
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

  const SLASH_PRESETS: Record<string, { mode: string; prefix: string }> = {
    "/explain": { mode: "ask", prefix: "Explain: " },
    "/test": { mode: "code", prefix: "Write tests for: " },
    "/refactor": { mode: "code", prefix: "Refactor: " },
  };

  const submit = () => {
    let prompt = input.trim();
    if (!prompt) return;
    let modeId = currentModeId;
    for (const [slash, preset] of Object.entries(SLASH_PRESETS)) {
      if (prompt === slash || prompt.startsWith(slash + " ")) {
        modeId = preset.mode;
        prompt = preset.prefix + prompt.slice(slash.length).trimStart();
        setCurrentModeId(modeId);
        vscode.postMessage({ type: "setMode", modeId });
        break;
      }
    }
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

  const approve = (callId: string, approved: boolean, options: ApproveOptions = {}) => {
    vscode.postMessage({ type: "approve", callId, approved, ...options });
    setMessages((prev) =>
      prev.map((m) =>
        m.role === "tool" && m.callId === callId
          ? { ...m, status: approved ? "approved" : "rejected" }
          : m
      )
    );
  };

  const setAutoApproveEnabled = (enabled: boolean) => {
    vscode.postMessage({ type: "setAutoApprove", enabled });
  };

  const openAlwaysAllow = () => {
    vscode.postMessage({ type: "requestAlwaysAllowList" });
    setShowAlwaysAllow(true);
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
      {autoApprove && (
        <div style={styles.autoApproveBanner}>Auto-approve is on. Approval-gated tools will run without prompting.</div>
      )}
      <div style={styles.transcript}>
        {messages.map((m, i) => (
          <div key={i} style={styles.message}>
            {m.role === "user" && <div><strong>You:</strong> {m.text}</div>}
            {m.role === "assistant" && <div><strong>Agent:</strong> {m.text}</div>}
            {m.role === "tool" && (
              <ToolCard
                msg={m}
                diffPreview={pendingDiffs.get(m.callId)}
                onApprove={approve}
                onToggle={toggleTool}
              />
            )}
          </div>
        ))}
      </div>
      {showAlwaysAllow && (
        <AlwaysAllowSettings
          rules={alwaysAllowRules}
          onClose={() => setShowAlwaysAllow(false)}
          onRemove={(id) => vscode.postMessage({ type: "removeAlwaysAllowRule", id })}
        />
      )}
      <StatusStrip
        usage={usage}
        llmConfig={llmConfig}
        mcpStatuses={mcpStatuses}
        indexStatus={indexStatus}
        autoApprove={autoApprove}
        onAutoApproveChange={setAutoApproveEnabled}
        onShowAlwaysAllow={openAlwaysAllow}
      />
      <div style={styles.composer}>
        {modes.length > 0 && (
          <select
            value={currentModeId}
            onChange={(e) => {
              setCurrentModeId(e.target.value);
              vscode.postMessage({ type: "setMode", modeId: e.target.value });
            }}
            style={styles.modeSelect}
          >
            {modes.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        )}
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

function StatusStrip({
  usage,
  llmConfig,
  mcpStatuses,
  indexStatus,
  autoApprove,
  onAutoApproveChange,
  onShowAlwaysAllow,
}: {
  usage: ConversationUsage;
  llmConfig: LlmConfigView;
  mcpStatuses: Record<string, McpServerStatus>;
  indexStatus: IndexStatusNotify | null;
  autoApprove: boolean;
  onAutoApproveChange: (enabled: boolean) => void;
  onShowAlwaysAllow: () => void;
}) {
  const cost = estimateCost(usage);
  const mcpSummary = formatMcpSummary(mcpStatuses);
  const indexSummary = formatIndexSummary(indexStatus);
  const cacheRead = usage.cacheReadTokens ?? 0;
  return (
    <div style={styles.statusStrip}>
      <ProviderPicker config={llmConfig} />
      {mcpSummary && <span title={mcpSummary.detail}>{mcpSummary.label}</span>}
      {indexSummary && <span title={indexSummary.detail}>{indexSummary.label}</span>}
      <button
        type="button"
        onClick={() => onAutoApproveChange(!autoApprove)}
        style={autoApprove ? styles.autoApproveToggleOn : styles.statusButton}
      >
        Auto-approve
      </button>
      <button type="button" onClick={onShowAlwaysAllow} style={styles.statusButton}>Allowlist</button>
      <span>↑ {formatTokens(usage.inputTokens)}</span>
      <span>↓ {formatTokens(usage.outputTokens)}</span>
      {cacheRead > 0 && (
        <span title="Prompt cache hits (cumulative)">⚡ {formatTokens(cacheRead)}</span>
      )}
      {cost !== undefined && <span>≈ ${cost.toFixed(cost < 0.01 ? 4 : 2)}</span>}
    </div>
  );
}

function formatIndexSummary(status: IndexStatusNotify | null): { label: string; detail: string } | undefined {
  if (!status) return undefined;
  if (status.state === "disabled") return undefined;
  const dot = status.state === "ready" ? "●" : status.state === "scanning" ? "◐" : "◌";
  const label = `${dot} Index ${formatCount(status.symbolsCount)}`;
  const detail = `Index: ${status.state} — ${status.filesScanned} files, ${status.symbolsCount} symbols`;
  return { label, detail };
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatMcpSummary(statuses: Record<string, McpServerStatus>): { label: string; detail: string } | undefined {
  const entries = Object.values(statuses);
  if (entries.length === 0) return undefined;
  const ready = entries.filter((status) => status.state === "ready").length;
  const label = `MCP ${ready}/${entries.length}`;
  const detail = entries
    .map((status) => `${status.server}: ${status.state}${status.toolCount !== undefined ? ` (${status.toolCount} tools)` : ""}${status.message ? ` - ${status.message}` : ""}`)
    .join("\n");
  return { label, detail };
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
  diffPreview,
  onApprove,
  onToggle,
}: {
  msg: Extract<Msg, { role: "tool" }>;
  diffPreview?: string;
  onApprove: (callId: string, approved: boolean, options?: ApproveOptions) => void;
  onToggle: (callId: string) => void;
}) {
  const outputRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (msg.status === "running" && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [msg.output, msg.status]);

  const duration = msg.durationMs === undefined ? "" : ` · ${formatDuration(msg.durationMs)}`;
  const command = inputString(msg.input, "command");
  const relPath = inputString(msg.input, "path");

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
      </div>
      {msg.status === "pending" && (
        <div style={styles.approvalPanel}>
          {diffPreview && <InlineDiff unified={diffPreview} />}
          <div style={styles.approvals}>
            <button onClick={() => onApprove(msg.callId, true)}>Approve</button>
            <button onClick={() => onApprove(msg.callId, false)}>Reject</button>
            <button onClick={() => onApprove(msg.callId, true, { rememberRule: makeToolRule(msg.name) })}>
              Always allow {msg.name}
            </button>
            {msg.name === "run_command" && command && (
              <button onClick={() => onApprove(msg.callId, true, { rememberRule: makeCommandRule(command) })}>
                Always allow {shortLabel(command)}
              </button>
            )}
            {isPathTool(msg.name) && relPath && (
              <button onClick={() => onApprove(msg.callId, true, { rememberRule: makePathRule(msg.name, relPath) })}>
                Always allow path
              </button>
            )}
            <button onClick={() => onApprove(msg.callId, true, { sessionCount: 5 })}>Approve next 5</button>
          </div>
        </div>
      )}
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

function AlwaysAllowSettings({
  rules,
  onClose,
  onRemove,
}: {
  rules: AlwaysAllowRule[];
  onClose: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div style={styles.settingsPanel}>
      <div style={styles.settingsHeader}>
        <strong>Always allow</strong>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      {rules.length === 0 ? (
        <div style={styles.emptySettings}>No rules yet.</div>
      ) : (
        <div style={styles.ruleList}>
          {rules.map((rule) => (
            <div key={rule.id} style={styles.ruleRow}>
              <div style={styles.ruleText}>
                <strong>{rule.tool}</strong>
                <span>{formatRule(rule)}</span>
              </div>
              <button type="button" onClick={() => onRemove(rule.id)}>Delete</button>
            </div>
          ))}
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

function makeToolRule(tool: string): AlwaysAllowRule {
  return {
    id: makeId(),
    tool,
    scope: "tool",
    createdAt: Date.now(),
  };
}

function makeCommandRule(command: string): AlwaysAllowRule {
  return {
    id: makeId(),
    tool: "run_command",
    scope: "argPattern",
    argKey: "command",
    pattern: `^${escapeRegex(command)}$`,
    createdAt: Date.now(),
  };
}

function makePathRule(tool: string, relPath: string): AlwaysAllowRule {
  return {
    id: makeId(),
    tool,
    scope: "argPattern",
    argKey: "path",
    pattern: relPath,
    createdAt: Date.now(),
  };
}

function formatRule(rule: AlwaysAllowRule): string {
  if (rule.scope === "tool") {
    return "Any invocation";
  }
  if (rule.argKey === "command") {
    return `Command matches ${rule.pattern ?? ""}`;
  }
  return `Path matches ${rule.pattern ?? ""}`;
}

function inputString(input: unknown, key: "command" | "path"): string | undefined {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return undefined;
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function isPathTool(tool: string): boolean {
  return tool === "apply_diff" || tool === "read_file" || tool === "list_dir" || tool === "search";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shortLabel(value: string): string {
  return value.length > 32 ? `${value.slice(0, 29)}...` : value;
}

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  autoApproveBanner: {
    margin: "8px 8px 0",
    padding: "6px 8px",
    color: "var(--vscode-errorForeground)",
    background: "var(--vscode-inputValidation-errorBackground)",
    border: "1px solid var(--vscode-inputValidation-errorBorder)",
    fontWeight: 600,
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
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
  },
  approvalPanel: {
    display: "grid",
    gap: 8,
    borderTop: "1px solid var(--vscode-panel-border)",
    padding: 8,
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
  statusButton: {
    border: "1px solid var(--vscode-button-border, var(--vscode-panel-border))",
    color: "var(--vscode-button-secondaryForeground)",
    background: "var(--vscode-button-secondaryBackground)",
    font: "inherit",
    padding: "2px 8px",
    cursor: "pointer",
  },
  autoApproveToggleOn: {
    border: "1px solid var(--vscode-inputValidation-errorBorder)",
    color: "var(--vscode-button-foreground)",
    background: "var(--vscode-errorForeground)",
    font: "inherit",
    padding: "2px 8px",
    cursor: "pointer",
  },
  settingsPanel: {
    margin: "0 8px 8px",
    padding: 8,
    border: "1px solid var(--vscode-panel-border)",
    background: "var(--vscode-editor-background)",
  },
  settingsHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  emptySettings: {
    color: "var(--vscode-descriptionForeground)",
  },
  ruleList: {
    display: "grid",
    gap: 6,
  },
  ruleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: 6,
    border: "1px solid var(--vscode-panel-border)",
  },
  ruleText: {
    display: "grid",
    gap: 2,
    minWidth: 0,
    overflowWrap: "anywhere",
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
  modeSelect: {
    background: "var(--vscode-input-background)",
    color: "var(--vscode-input-foreground)",
    border: "1px solid var(--vscode-input-border, var(--vscode-panel-border))",
    borderRadius: 2,
    padding: "2px 4px",
    fontSize: "inherit",
    flexShrink: 0,
    marginRight: 4,
  },
  send: {
    marginLeft: 4,
  },
};
