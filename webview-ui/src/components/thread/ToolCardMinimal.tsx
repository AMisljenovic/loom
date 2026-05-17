import { useEffect, useRef } from "react";
import type { Msg } from "../../../../src/shared/protocol";
import * as Ico from "../../brand/icons";
import { peekLines, toolInputLine, toolLabel } from "../../util/activity";
import { ApprovalActions } from "./ApprovalActions";
import { OpenInEditorButton } from "./OpenInEditorButton";

interface ToolCardMinimalProps {
    msg: Extract<Msg, { role: "tool" }>;
    pendingDiff?: string;
    liveOutput?: string;
    onToggleExpanded: (callId: string) => void;
}

function ToolIcon({ name }: { name: string }) {
    const size = 12;
    switch (name) {
        case "apply_diff":
            return <Ico.Diff size={size} />;
        case "run_command":
        case "run_command_background":
        case "read_process_output":
        case "kill_process":
            return <Ico.Terminal size={size} />;
        case "read_file":
        case "list_dir":
            return <Ico.File size={size} />;
        case "search":
        case "grep":
            return <Ico.Search size={size} />;
        case "find_symbol":
        case "find_references":
        case "semantic_search":
            return <Ico.Code size={size} />;
        case "spawn_subagent":
            return <Ico.Compass size={size} />;
        case "get_diagnostics":
            return <Ico.Bug size={size} />;
        default:
            return <Ico.Spark size={size} />;
    }
}

function prettyInput(input: unknown): string {
    if (input == null) return "(no args)";
    try {
        return JSON.stringify(input, null, 2);
    } catch {
        return String(input);
    }
}

function guessLanguage(name: string, output: string): string {
    const trimmed = output.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
            JSON.parse(trimmed);
            return "json";
        } catch {
            // not valid JSON, fall through
        }
    }
    switch (name) {
        case "run_command":
        case "run_command_background":
        case "read_process_output":
            return "shellscript";
        default:
            return "plaintext";
    }
}

export function ToolCardMinimal({ msg, pendingDiff, liveOutput, onToggleExpanded }: ToolCardMinimalProps) {
    const expandRef = useRef<HTMLDivElement>(null);
    const expanded = msg.expanded === true;
    const isPending = msg.status === "pending";
    const isRunning = msg.status === "running";
    const isError = msg.status === "error";

    const label = toolLabel(msg.name).trim() || "Tool";
    const target = toolInputLine(msg.name, msg.input);
    const description = target && target !== msg.name ? target : "";

    const outputText = liveOutput ?? msg.output ?? (isPending ? (pendingDiff ?? "") : "");
    const expandedOutput = outputText || (isRunning ? "(running...)" : isPending ? "(awaiting approval)" : "(no output)");
    const { lines: outputPeek, more: hasMore } = peekLines(outputText, 3);

    const showDuration = typeof msg.durationMs === "number" && msg.durationMs >= 100;
    const statusBadge = isPending
        ? "waiting"
        : isError
            ? "error"
            : isRunning
                ? "running"
                : showDuration
                    ? `${(msg.durationMs! / 1000).toFixed(1)}s`
                    : null;

    const onHeaderClick = () => onToggleExpanded(msg.callId);

    useEffect(() => {
        if (!expanded) return;
        const frame = window.requestAnimationFrame(() => {
            expandRef.current?.scrollIntoView({ block: "nearest" });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [expanded]);

    return (
        <div className={`tc-mini tc-${msg.status}${expanded ? " expanded" : ""}${isError ? " errored" : ""}`}>
            <button
                type="button"
                className="tc-head"
                onClick={onHeaderClick}
                aria-expanded={expanded}
                title={`${msg.name}${target ? `: ${target}` : ""}`}
            >
                <span className="tc-icon"><ToolIcon name={msg.name} /></span>
                <span className={`tc-pip${isRunning ? " running" : ""}`} />
                <span className="tc-label">{label}</span>
                {description && <span className="tc-desc">{description}</span>}
                {statusBadge && (
                    <span className={`tc-status tc-status-${isPending ? "pending" : isError ? "error" : isRunning ? "running" : "done"}`}>
                        {statusBadge}
                    </span>
                )}
                <span className={`tc-chev${expanded ? " open" : ""}`}>
                    <Ico.Chev size={10} />
                </span>
            </button>

            {/* Collapsed peek: only when not expanded and there's something to show. */}
            {!expanded && outputPeek.length > 0 && (
                <div className="tc-pane tc-out">
                    <pre className="tc-pane-body">{outputPeek.join("\n")}{hasMore ? "\n…" : ""}</pre>
                </div>
            )}

            {/* Expanded body: always visible new content — full output AND raw args. */}
            {expanded && (
                <div className="tc-expand" ref={expandRef}>
                    <div className="tc-pane tc-out">
                        <div className="tc-pane-label">
                            <span>output</span>
                            {outputText && (
                                <OpenInEditorButton
                                    id={`tool-${msg.callId}`}
                                    title={`${msg.name} output (${msg.callId.slice(0, 4)})`}
                                    content={outputText}
                                    language={guessLanguage(msg.name, outputText)}
                                />
                            )}
                        </div>
                        <pre className="tc-pane-body">{expandedOutput}</pre>
                    </div>
                    <div className="tc-pane tc-args">
                        <div className="tc-pane-label">args</div>
                        <pre className="tc-pane-body">{prettyInput(msg.input)}</pre>
                    </div>
                </div>
            )}

            {expanded && isPending && (
                <div className="tc-pending">
                    <ApprovalActions msg={msg} />
                </div>
            )}
        </div>
    );
}
