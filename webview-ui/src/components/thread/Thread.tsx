import { useEffect, useRef } from "react";
import type { Msg } from "../../../../src/shared/protocol";
import * as Ico from "../../brand/icons";
import { MarkdownMessage } from "./MarkdownMessage";
import { QuestionForm } from "./QuestionForm";
import { SubAgentCard } from "./SubAgentCard";
import { ToolCardMinimal } from "./ToolCardMinimal";

interface ThreadProps {
    messages: Msg[];
    pendingDiffs: Map<string, string>;
    pendingOutputs: Map<string, string>;
    busy: boolean;
    onToggleToolExpanded: (callId: string) => void;
}

export function Thread({ messages, pendingDiffs, pendingOutputs, onToggleToolExpanded }: ThreadProps) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.closest(".tc-mini")) {
            return;
        }
        bottomRef.current?.scrollIntoView({ block: "end" });
    }, [messages, pendingOutputs]);

    return (
        <div className="thread" role="log" aria-live="polite">
            {messages.map((msg, i) => {
                if (msg.role === "user") {
                    return (
                        <div key={i} className="msg msg-user">
                            <div className="msg-who">You</div>
                            <div className="msg-body">
                                {msg.text && <div>{msg.text}</div>}
                                {msg.references && msg.references.length > 0 && (
                                    <div className="msg-references">
                                        {msg.references.map((ref) => (
                                            <span className="msg-reference" key={ref.id} title={`${ref.kind}: ${ref.path}`}>
                                                {ref.kind === "folder" ? "folder" : "file"} {ref.path}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
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
                        return <SummaryCard key={i} text={msg.text} />;
                    }
                    if (msg.kind === "error") {
                        return <ErrorCard key={i} text={msg.text} />;
                    }
                    return <IntentLine key={i} text={msg.text} />;
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

export function IntentLine({ text }: { text: string }) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    return <div className="intent-line"><MarkdownMessage text={trimmed} /></div>;
}

export function SummaryCard({ text }: { text: string }) {
    return (
        <div className="summary-card">
            <div className="summary-head">
                <Ico.Check size={12} />
                <span>Summary</span>
            </div>
            <div className="summary-body markdown-body">
                <MarkdownMessage text={text} />
            </div>
        </div>
    );
}

export function ErrorCard({ text }: { text: string }) {
    return (
        <div className="error-card" role="alert">
            <div className="error-head">
                <Ico.Warn size={12} />
                <span>Error</span>
            </div>
            <div className="error-body">{text}</div>
        </div>
    );
}
