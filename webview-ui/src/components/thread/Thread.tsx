import { useEffect, useRef } from "react";
import type { Msg } from "../../../../src/shared/protocol";
import * as Ico from "../../brand/icons";
import { stripStructuralTags } from "../../util/markdown";
import { post } from "../../vscode";
import { CopyButton } from "./CopyButton";
import { MarkdownMessage } from "./MarkdownMessage";
import { OpenInEditorButton } from "./OpenInEditorButton";
import { QuestionForm } from "./QuestionForm";
import { SubAgentCard } from "./SubAgentCard";
import { ToolCardMinimal } from "./ToolCardMinimal";

interface ThreadProps {
    messages: Msg[];
    pendingDiffs: Map<string, string>;
    pendingOutputs: Map<string, string>;
    busy: boolean;
    onToggleToolExpanded: (callId: string) => void;
    onContinue: (prompt: string) => void;
    conversationId?: string;
}

export function Thread({ messages, pendingDiffs, pendingOutputs, busy, onToggleToolExpanded, onContinue, conversationId }: ThreadProps) {
    const threadRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const stuckRef = useRef(true);

    useEffect(() => {
        const el = threadRef.current;
        if (!el) return;
        const onScroll = () => {
            const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
            stuckRef.current = distance < 32;
        };
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => el.removeEventListener("scroll", onScroll);
    }, []);

    useEffect(() => {
        if (!stuckRef.current) return;
        const raf = window.requestAnimationFrame(() => {
            bottomRef.current?.scrollIntoView({ block: "end" });
        });
        return () => window.cancelAnimationFrame(raf);
    }, [messages, pendingOutputs]);

    return (
        <div className="thread" role="log" aria-live="polite" ref={threadRef}>
            {messages.map((msg, i) => {
                if (msg.role === "user") {
                    return (
                        <div key={i} className="msg msg-user">
                            <div className="msg-who">You</div>
                            <div className="msg-body">
                                {msg.command && <div className="command-chip">expanded from /{msg.command.name}</div>}
                                {msg.text && <div>{msg.text}</div>}
                                {msg.references && msg.references.length > 0 && (
                                    <div className="msg-references">
                                        {msg.references.map((ref) => (
                                            <span
                                                className={`msg-reference ref-${ref.kind}`}
                                                key={ref.id}
                                                title={ref.kind === "image" ? ref.mimeType : `${ref.kind}: ${ref.path}`}
                                            >
                                                {ref.kind === "image" ? (
                                                    <>
                                                        <img className="reference-thumb" src={`data:${ref.mimeType};base64,${ref.data}`} alt="" />
                                                        image {ref.label || "Pasted image"}
                                                    </>
                                                ) : (
                                                    <>{ref.kind === "folder" ? "folder" : "file"} {ref.path}</>
                                                )}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                            {msg.text && (
                                <div className="msg-actions">
                                    <CopyButton text={msg.text} />
                                    {conversationId && (
                                        <button
                                            className="msg-action-btn"
                                            title="Branch a new session from here"
                                            onClick={() => post({ type: "sessionBranch", conversationId, messageIndex: i })}
                                        >
                                            <Ico.Plus size={11} /> Branch
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                }
                if (msg.role === "progress") {
                    // Progress notes are surfaced through the composer's
                    // live-status pill — no inline rendering in the
                    // transcript.
                    return null;
                }
                if (msg.role === "assistant") {
                    if (msg.kind === "summary") {
                        return <SummaryCard key={i} id={`assistant-${i}`} text={msg.text} />;
                    }
                    if (msg.kind === "error") {
                        return <ErrorCard key={i} text={msg.text} />;
                    }
                    return <IntentLine key={i} id={`assistant-${i}`} text={msg.text} />;
                }
                if (msg.role === "tool") {
                    return (
                        <ToolCardMinimal
                            key={msg.callId ?? i}
                            msg={msg}
                            pendingDiff={pendingDiffs.get(msg.callId)}
                            liveOutput={pendingOutputs.get(msg.callId)}
                            onToggleExpanded={onToggleToolExpanded}
                        />
                    );
                }
                if (msg.role === "todo") {
                    return <TodoCard key={`todo-${msg.taskId}`} msg={msg} />;
                }
                if (msg.role === "stop") {
                    return <StopCard key={msg.taskId ? `stop-${msg.taskId}` : i} msg={msg} busy={busy} onContinue={onContinue} />;
                }
                if (msg.role === "question") {
                    return <QuestionForm key={msg.callId ?? i} msg={msg} />;
                }
                if (msg.role === "subagent") {
                    return (
                        <SubAgentCard
                            key={msg.subTaskId ?? i}
                            msg={msg}
                            pendingDiffs={pendingDiffs}
                            pendingOutputs={pendingOutputs}
                            onToggleToolExpanded={onToggleToolExpanded}
                        />
                    );
                }
                return null;
            })}
            <div ref={bottomRef} />
        </div>
    );
}

export function StopCard({
    msg,
    busy,
    onContinue,
}: {
    msg: Extract<Msg, { role: "stop" }>;
    busy: boolean;
    onContinue: (prompt: string) => void;
}) {
    return (
        <div className={`stop-card stop-${msg.reason}`} role="status">
            <div className="stop-head">
                <Ico.Warn size={12} />
                <span>{msg.title}</span>
            </div>
            <div className="stop-body">{msg.text}</div>
            <div className="stop-actions">
                {msg.canContinue && (
                    <button
                        className="btn btn-primary btn-sm stop-continue"
                        disabled={busy}
                        onClick={() => onContinue(msg.continuePrompt || "Continue from where you stopped.")}
                    >
                        <Ico.Send size={12} /> Continue
                    </button>
                )}
                <CopyButton text={msg.text} />
            </div>
        </div>
    );
}

export function TodoCard({ msg }: { msg: Extract<Msg, { role: "todo" }> }) {
    const done = msg.items.filter((item) => item.status === "done").length;
    return (
        <div className="todo-card">
            <div className="todo-head">
                <span className="todo-dot" />
                <span>{msg.title || "Update Todos"}</span>
                <span className="todo-count">{done}/{msg.items.length}</span>
            </div>
            <ul className="todo-list">
                {msg.items.map((item) => (
                    <li key={item.id} className={`todo-item todo-${item.status}`}>
                        <span className="todo-box" aria-hidden="true">
                            {item.status === "done" ? <Ico.Check size={11} /> : item.status === "in_progress" ? <Ico.Spark size={11} /> : null}
                        </span>
                        <span className="todo-text">{item.text}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export function IntentLine({ text, id }: { text: string; id?: string }) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const copyText = stripStructuralTags(trimmed);
    return (
        <div className="intent-line">
            <div className="intent-tag">Reasoning</div>
            <MarkdownMessage text={trimmed} />
            {copyText && (
                <div className="msg-actions intent-actions">
                    {id && (
                        <OpenInEditorButton
                            id={id}
                            title="Loom reasoning"
                            content={copyText}
                            language="markdown"
                        />
                    )}
                    <CopyButton text={copyText} />
                </div>
            )}
        </div>
    );
}

export function SummaryCard({ text, id }: { text: string; id?: string }) {
    const copyText = stripStructuralTags(text);
    return (
        <div className="summary-card">
            <div className="summary-head">
                <Ico.Check size={12} />
                <span>Summary</span>
            </div>
            <div className="summary-body markdown-body">
                <MarkdownMessage text={text} />
            </div>
            {copyText && (
                <div className="msg-actions">
                    {id && (
                        <OpenInEditorButton
                            id={id}
                            title="Loom summary"
                            content={copyText}
                            language="markdown"
                        />
                    )}
                    <CopyButton text={copyText} />
                </div>
            )}
        </div>
    );
}

export function ErrorCard({ text }: { text: string }) {
    const { code, headline, hint } = classifyError(text);
    return (
        <div className={`error-card${code ? ` error-card-${code}` : ""}`} role="alert">
            <div className="error-head">
                <Ico.Warn size={12} />
                <span>{code ? `Error ${code}` : "Error"}</span>
                {headline && <span className="error-headline">{headline}</span>}
            </div>
            {hint && <div className="error-hint">{hint}</div>}
            <div className="error-body">{text}</div>
            {text && (
                <div className="msg-actions">
                    <CopyButton text={text} />
                </div>
            )}
        </div>
    );
}

interface ClassifiedError {
    code?: string;
    headline?: string;
    hint?: string;
}

export function classifyError(text: string): ClassifiedError {
    const lower = text.toLowerCase();
    const codeMatch = text.match(/\b(4\d\d|5\d\d)\b/);
    const code = codeMatch?.[1];
    if (code === "401" || /unauthor/.test(lower) || /invalid api key/.test(lower) || /authentication/.test(lower)) {
        return {
            code: code ?? "401",
            headline: "Authentication failed",
            hint: "Check that the correct API key is set for the selected provider (Model menu → Settings → API key).",
        };
    }
    if (code === "403" || /forbidden|permission denied/.test(lower)) {
        return {
            code: code ?? "403",
            headline: "Forbidden",
            hint: "Your API key is valid but the model or endpoint isn't accessible. Verify org/project access and the selected model.",
        };
    }
    if (code === "404" || /not found|no such model/.test(lower)) {
        return {
            code: code ?? "404",
            headline: "Endpoint or model not found",
            hint: "Double-check the Base URL and the model id in Loom's Model settings. For OpenAI-compatible providers, confirm the Base URL ends with /v1.",
        };
    }
    if (code === "429" || /rate limit|too many requests/.test(lower)) {
        return { code: code ?? "429", headline: "Rate limited", hint: "Wait a moment or switch models." };
    }
    if (/5\d\d/.test(code ?? "") || /server error|bad gateway|unavailable/.test(lower)) {
        return { code, headline: "Upstream server error", hint: "The LLM provider returned an error. Try again or switch models." };
    }
    if (/econnrefused|enotfound|fetch failed|getaddrinfo|connection reset/.test(lower)) {
        return {
            headline: "Network error",
            hint: "Loom could not reach the LLM endpoint. Verify the Base URL, that the local server is running (Ollama/LM Studio), and that there's no proxy in the way.",
        };
    }
    return {};
}
