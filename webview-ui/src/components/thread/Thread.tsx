import { useRef } from "react";
import type { Msg } from "../../../../src/shared/protocol";
import { ToolCard } from "./ToolCard";

interface ThreadProps {
    messages: Msg[];
    pendingDiffs: Map<string, string>;
    pendingOutputs: Map<string, string>;
}

export function Thread({ messages, pendingDiffs, pendingOutputs }: ThreadProps) {
    const bottomRef = useRef<HTMLDivElement>(null);

    return (
        <div className="thread" role="log" aria-live="polite">
            {messages.map((msg, i) => {
                if (msg.role === "user") {
                    return (
                        <div key={i} className="msg msg-user">
                            <div className="msg-who">You</div>
                            <div className="msg-body">{msg.text}</div>
                        </div>
                    );
                }
                if (msg.role === "assistant") {
                    return (
                        <div key={i} className="msg msg-assistant">
                            <div className="msg-who">Loom</div>
                            <div className="msg-body">{msg.text}</div>
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
                return null;
            })}
            <div ref={bottomRef} />
        </div>
    );
}
