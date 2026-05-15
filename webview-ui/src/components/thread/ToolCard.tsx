import { useState } from "react";
import type { Msg } from "../../../../src/shared/protocol";
import * as Ico from "../../brand/icons";
import { ApprovalActions } from "./ApprovalActions";
import { ToolBody } from "./tools/index";

const STATUS_LABEL: Record<string, string> = {
    pending: "waiting",
    approved: "approved",
    rejected: "rejected",
    running: "running",
    done: "done",
    error: "error",
};

interface ToolCardProps {
    msg: Extract<Msg, { role: "tool" }>;
    pendingDiff?: string;
    liveOutput?: string;
}

function ToolIcon({ name }: { name: string }) {
    if (name === "apply_diff") return <Ico.Diff size={13} />;
    if (name === "run_command") return <Ico.Terminal size={13} />;
    if (name === "read_file") return <Ico.File size={13} />;
    if (name === "list_dir") return <Ico.File size={13} />;
    if (name === "grep" || name === "search") return <Ico.Search size={13} />;
    if (name === "find_symbol" || name === "find_references") return <Ico.Code size={13} />;
    return <Ico.Spark size={13} />;
}

export function ToolCard({ msg, pendingDiff, liveOutput }: ToolCardProps) {
    const [expanded, setExpanded] = useState(msg.status === "pending" || msg.expanded === true);

    const statusClass = msg.status;
    const isRunning = msg.status === "running";

    return (
        <div className={`tool-card tc-${statusClass}`}>
            <button
                className="tc-head"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
            >
                <span className="tc-icon"><ToolIcon name={msg.name} /></span>
                <span className="tc-name">{msg.name}</span>
                <span className={`tc-pip${isRunning ? " running" : ""}`} />
                <span className="tc-status">{STATUS_LABEL[msg.status] ?? msg.status}</span>
                {msg.durationMs !== undefined && (
                    <span className="tc-dur">{(msg.durationMs / 1000).toFixed(1)}s</span>
                )}
                <span className="tc-chev">
                    {expanded ? <Ico.ChevDn size={9} /> : <Ico.Chev size={9} />}
                </span>
            </button>
            {expanded && (
                <div className="tc-body">
                    {msg.status === "pending" && (
                        <ApprovalActions msg={msg} />
                    )}
                    {msg.status !== "pending" && (
                        <ToolBody msg={msg} pendingDiff={pendingDiff} liveOutput={liveOutput} />
                    )}
                </div>
            )}
        </div>
    );
}
