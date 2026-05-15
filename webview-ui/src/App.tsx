import React, { useEffect, useRef, useState } from "react";

// VS Code webview API handle
declare function acquireVsCodeApi(): { postMessage: (m: unknown) => void };
const vscode = acquireVsCodeApi();

type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "tool"; name: string; status: "pending" | "approved" | "rejected" | "done"; summary?: string; callId: string };

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
          });
        } else if (m.type === "toolResult") {
          for (let i = next.length - 1; i >= 0; i--) {
            const t = next[i];
            if (t.role === "tool" && t.callId === m.callId) {
              next[i] = { ...t, status: "done", summary: m.summary };
              break;
            }
          }
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "var(--vscode-font-family)" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            {m.role === "user" && <div><strong>You:</strong> {m.text}</div>}
            {m.role === "assistant" && <div><strong>Agent:</strong> {m.text}</div>}
            {m.role === "tool" && (
              <div style={{ border: "1px solid var(--vscode-panel-border)", padding: 6 }}>
                <div><strong>Tool:</strong> {m.name} — {m.status}</div>
                {m.status === "pending" && (
                  <div style={{ marginTop: 4 }}>
                    <button onClick={() => approve(m.callId, true)}>Approve</button>
                    <button onClick={() => approve(m.callId, false)} style={{ marginLeft: 4 }}>Reject</button>
                  </div>
                )}
                {m.summary && <div style={{ marginTop: 4, opacity: 0.8 }}>{m.summary}</div>}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", padding: 8, borderTop: "1px solid var(--vscode-panel-border)" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Ask the agent…"
          style={{ flex: 1, padding: 4 }}
          disabled={busy}
        />
        <button onClick={submit} disabled={busy} style={{ marginLeft: 4 }}>Send</button>
      </div>
    </div>
  );
}
