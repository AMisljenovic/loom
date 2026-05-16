import { useEffect, useRef } from "react";
import type { Msg } from "../../../../src/shared/protocol";
import { MarkdownMessage } from "./MarkdownMessage";
import { QuestionForm } from "./QuestionForm";
import { SubAgentCard } from "./SubAgentCard";
import { ToolCard } from "./ToolCard";

interface ThreadProps {
    messages: Msg[];
    pendingDiffs: Map<string, string>;
    pendingOutputs: Map<string, string>;
    busy: boolean;
}

export function Thread({ messages, pendingDiffs, pendingOutputs }: ThreadProps) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
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
                    return (
                        <div key={i} className={`progress-note progress-${msg.phase}`}>
                            <span className="progress-dot" />
                            <span>{msg.text}</span>
                        </div>
                    );
                }
                if (msg.role === "assistant") {
                    return (
                        <div key={i} className="msg msg-assistant">
                            <div className="msg-who">Loom</div>
                            <div className="msg-body markdown-body">
                                <MarkdownMessage text={msg.text} />
                            </div>
                        </div>
                    );
                }
                if (msg.role === "tool") {
                    return (
                        <ToolCard
                            key={msg.callId ?? i}
                            msg={msg}
                            pendingDiff={pendingDiffs.get(msg.callId)}
                            liveOutput={pendingOutputs.get(msg.callId)}
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
                        />
                    );
                }
                return null;
            })}
            <div ref={bottomRef} />
        </div>
    );
}
