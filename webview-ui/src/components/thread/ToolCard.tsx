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
    if (name === "spawn_subagent") return <Ico.Compass size={13} />;
    return <Ico.Spark size={13} />;
}

export function ToolCard({ msg, pendingDiff, liveOutput }: ToolCardProps) {
    const [expanded, setExpanded] = useState(msg.status === "pending" || msg.expanded === true);

    const statusClass = msg.status;
    const isRunning = msg.status === "running";
    const inputHint = summarizeInput(msg.name, msg.input);

    return (
        <div className={`tool-card tc-${statusClass}${expanded ? " open" : ""}`}>
            <button
                className="tc-head"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                title={inputHint ? `${msg.name}: ${inputHint}` : msg.name}
            >
                <span className="tc-icon"><ToolIcon name={msg.name} /></span>
                <span className="tc-name">{msg.name}</span>
                {inputHint && <span className="tc-hint" title={inputHint}>{inputHint}</span>}
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

function summarizeInput(name: string, input: unknown): string | undefined {
    if (!input || typeof input !== "object") return undefined;
    const i = input as Record<string, unknown>;
    const pick = (key: string): string | undefined => {
        const v = i[key];
        return typeof v === "string" && v ? v : undefined;
    };
    switch (name) {
        case "read_file":
        case "list_dir":
        case "apply_diff":
            return pick("path");
        case "search":
        case "find_symbol":
        case "find_references":
        case "semantic_search":
            return pick("query");
        case "run_command":
        case "run_command_background":
            return pick("command");
        case "kill_process":
        case "read_process_output":
            return pick("processId");
        case "load_skill": {
            const ids = i.ids;
            if (Array.isArray(ids)) return ids.join(", ");
            return undefined;
        }
        case "get_diagnostics":
            return pick("path") ?? pick("severity") ?? "workspace";
        case "spawn_subagent":
            return pick("task") ?? pick("type");
        default:
            return pick("path") ?? pick("query") ?? pick("command");
    }
}
