import { useState } from "react";
import type { Msg } from "../../../../src/shared/protocol";
import * as Ico from "../../brand/icons";
import { formatTokens } from "../../util/format";
import { post } from "../../vscode";
import { MarkdownMessage } from "./MarkdownMessage";
import { ToolCard } from "./ToolCard";

interface SubAgentCardProps {
    msg: Extract<Msg, { role: "subagent" }>;
    pendingDiffs: Map<string, string>;
    pendingOutputs: Map<string, string>;
}

export function SubAgentCard({ msg, pendingDiffs, pendingOutputs }: SubAgentCardProps) {
    const [expanded, setExpanded] = useState(msg.expanded === true);
    const running = msg.status === "running";

    return (
        <div className={`subagent-card subagent-${msg.status}`}>
            <button className="subagent-head" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
                <span className={`subagent-pip${running ? " running" : ""}`} />
                <span className="subagent-main">
                    <span className="subagent-title">{msg.type}</span>
                    <span className="subagent-task">{msg.task}</span>
                </span>
                <span className="subagent-meta">
                    {msg.toolCalls !== undefined && <span>{msg.toolCalls} calls</span>}
                    {msg.tokensUsed !== undefined && <span>{formatTokens(msg.tokensUsed)}</span>}
                    {msg.truncated && <span>truncated</span>}
                </span>
                <span className="tc-chev">{expanded ? <Ico.ChevDn size={9} /> : <Ico.Chev size={9} />}</span>
            </button>
            <div className="subagent-summary">
                {running ? (
                    <span>Researching...</span>
                ) : (
                    <MarkdownMessage text={msg.summary || statusText(msg.status)} />
                )}
            </div>
            {running && (
                <div className="subagent-actions">
                    <button className="btn" onClick={() => post({ type: "subagentCancel", subTaskId: msg.subTaskId })}>
                        <Ico.Stop size={11} />
                        <span>Cancel research</span>
                    </button>
                </div>
            )}
            {expanded && (
                <div className="subagent-trace">
                    {msg.trace.length === 0 ? (
                        <div className="subagent-empty">No trace yet.</div>
                    ) : (
                        msg.trace.map((trace, i) => {
                            if (trace.role === "user") {
                                return (
                                    <div key={i} className="msg msg-user subagent-msg">
                                        <div className="msg-who">Task</div>
                                        <div className="msg-body">{trace.text}</div>
                                    </div>
                                );
                            }
                            if (trace.role === "assistant") {
                                return (
                                    <div key={i} className="msg msg-assistant subagent-msg">
                                        <div className="msg-who">Research</div>
                                        <div className="msg-body markdown-body">
                                            <MarkdownMessage text={trace.text} />
                                        </div>
                                    </div>
                                );
                            }
                            if (trace.role === "tool") {
                                return (
                                    <ToolCard
                                        key={trace.callId ?? i}
                                        msg={trace}
                                        pendingDiff={pendingDiffs.get(trace.callId)}
                                        liveOutput={pendingOutputs.get(trace.callId)}
                                    />
                                );
                            }
                            return null;
                        })
                    )}
                </div>
            )}
        </div>
    );
}

function statusText(status: Extract<Msg, { role: "subagent" }>["status"]): string {
    if (status === "cancelled") return "Sub-agent cancelled.";
    if (status === "error") return "Sub-agent stopped with an error.";
    return "Sub-agent completed.";
}
