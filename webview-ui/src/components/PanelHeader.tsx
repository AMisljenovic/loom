import { LoomMark } from "../brand/LoomMark";
import * as Ico from "../brand/icons";

interface PanelHeaderProps {
    busy: boolean;
    sessionsOpen: boolean;
    processCount?: number;
    approvalCount?: number;
    onSetup: () => void;
    onToggleSessions: () => void;
    onToggleProcesses: () => void;
    onToggleApprovals: () => void;
}

export function PanelHeader({
    busy,
    sessionsOpen,
    processCount = 0,
    approvalCount = 0,
    onSetup,
    onToggleSessions,
    onToggleProcesses,
    onToggleApprovals,
}: PanelHeaderProps) {
    return (
        <div className="panel-header">
            <div className="brand">
                <span style={{ color: "var(--accent)", display: "inline-flex" }}>
                    <LoomMark size={16} />
                </span>
                <span className="brand-wordmark">Loom</span>
            </div>
            <div className="header-actions">
                <button
                    className={`icon-button${approvalCount > 0 ? " has-count" : ""}`}
                    title={approvalCount > 0 ? `${approvalCount} grouped approvals waiting` : "Approval center"}
                    onClick={onToggleApprovals}
                    aria-label="Approval center"
                >
                    <Ico.Check size={13} />
                    {approvalCount > 0 && <span className="header-count">{approvalCount}</span>}
                </button>
                <button
                    className={`icon-button${processCount > 0 ? " has-count" : ""}`}
                    title={processCount > 0 ? `${processCount} recent background processes` : "Process dashboard"}
                    onClick={onToggleProcesses}
                    aria-label="Process dashboard"
                >
                    <Ico.Terminal size={13} />
                    {processCount > 0 && <span className="header-count">{processCount}</span>}
                </button>
                <button
                    className="icon-button"
                    title="Setup and model settings"
                    onClick={onSetup}
                    aria-label="Setup and model settings"
                >
                    <Ico.Settings size={13} />
                </button>
                <button
                    className={`icon-button${sessionsOpen ? " active" : ""}`}
                    title={sessionsOpen ? "Hide sessions" : "New or switch conversation"}
                    disabled={busy}
                    onClick={onToggleSessions}
                    aria-label={sessionsOpen ? "Hide sessions" : "New or switch conversation"}
                    aria-expanded={sessionsOpen}
                >
                    <Ico.Plus size={13} />
                </button>
            </div>
        </div>
    );
}
