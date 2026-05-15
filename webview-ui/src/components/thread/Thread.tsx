import { useEffect, useMemo, useRef } from "react";
import type { Msg } from "../../../../src/shared/protocol";
import { MarkdownMessage } from "./MarkdownMessage";
import { ToolCard } from "./ToolCard";

interface ThreadProps {
    messages: Msg[];
    pendingDiffs: Map<string, string>;
    pendingOutputs: Map<string, string>;
    busy: boolean;
}

export function Thread({ messages, pendingDiffs, pendingOutputs, busy }: ThreadProps) {
    const bottomRef = useRef<HTMLDivElement>(null);
    const activity = useMemo(() => summarizeActivity(messages, busy), [messages, busy]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ block: "end" });
    }, [messages, pendingOutputs, busy]);

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
                return null;
            })}
            {activity && <ActivitySummary activity={activity} />}
            <div ref={bottomRef} />
        </div>
    );
}

interface Activity {
    summary: string;
    details: string[];
    open: boolean;
}

function summarizeActivity(messages: Msg[], busy: boolean): Activity | null {
    const tools = messages.filter((m): m is Extract<Msg, { role: "tool" }> => m.role === "tool");
    if (tools.length === 0) {
        return busy
            ? { summary: "Activity: thinking through the request", details: ["No tool activity yet."], open: true }
            : null;
    }

    const counts = new Map<string, number>();
    for (const tool of tools) {
        counts.set(tool.status, (counts.get(tool.status) ?? 0) + 1);
    }
    const latest = tools[tools.length - 1];
    const details = [
        ...["pending", "approved", "running", "done", "error", "rejected"].flatMap((status) => {
            const count = counts.get(status) ?? 0;
            return count ? [`${count} ${status}`] : [];
        }),
        latest ? `Latest: ${latest.name} (${latest.status})` : "",
    ].filter(Boolean);

    const active = (counts.get("pending") ?? 0) + (counts.get("approved") ?? 0) + (counts.get("running") ?? 0);
    const summary = active > 0
        ? `Activity: ${active} tool ${active === 1 ? "step" : "steps"} active`
        : `Activity: ${tools.length} tool ${tools.length === 1 ? "step" : "steps"} completed`;
    return { summary, details, open: busy || active > 0 };
}

function ActivitySummary({ activity }: { activity: Activity }) {
    return (
        <details className="activity-summary" open={activity.open}>
            <summary>{activity.summary}</summary>
            <ul>
                {activity.details.map((detail) => <li key={detail}>{detail}</li>)}
            </ul>
        </details>
    );
}
