import { LoomMark } from "../brand/LoomMark";
import * as Ico from "../brand/icons";

interface PanelHeaderProps {
    busy: boolean;
    sessionsOpen: boolean;
    onSetup: () => void;
    onToggleSessions: () => void;
}

export function PanelHeader({ busy, sessionsOpen, onSetup, onToggleSessions }: PanelHeaderProps) {
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
