import React, { useEffect, useRef, useState } from "react";

// VS Code webview API handle
declare function acquireVsCodeApi(): { postMessage: (m: unknown) => void };
const vscode = acquireVsCodeApi();

type ToolStatus = "pending" | "approved" | "rejected" | "running" | "done" | "error";

type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | {
    role: "tool";
    name: string;
    status: ToolStatus;
    callId: string;
    input?: unknown;
    output?: string;
    durationMs?: number;
    expanded?: boolean;
  };

export function App() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const assistantRef = useRef<number | null>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const m = e.data;
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
          setBusy(false);
          assistantRef.current = null;
        } else if (m.type === "error") {
          next.push({ role: "assistant", text: `Error: ${m.error}` });
          setBusy(false);
        }
        return next;
      });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const submit = () => {
    if (!input.trim() || busy) return;
    setMessages((m) => [...m, { role: "user", text: input }]);
    vscode.postMessage({ type: "submit", prompt: input });
    setInput("");
    setBusy(true);
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
      <div style={styles.composer}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Ask the agent..."
          style={styles.input}
          disabled={busy}
        />
        <button onClick={submit} disabled={busy} style={styles.send}>Send</button>
      </div>
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
  input: {
    flex: 1,
    padding: 4,
  },
  send: {
    marginLeft: 4,
  },
};
