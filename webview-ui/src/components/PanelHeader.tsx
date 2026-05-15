import { LoomMark } from "../brand/LoomMark";
import * as Ico from "../brand/icons";
import { post } from "../vscode";

interface PanelHeaderProps {
    busy: boolean;
    onSettings: () => void;
}

export function PanelHeader({ busy, onSettings }: PanelHeaderProps) {
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
                    title="New conversation"
                    disabled={busy}
                    onClick={() => post({ type: "newConversation" })}
                    aria-label="New conversation"
                >
                    <Ico.Plus size={13} />
                </button>
                <button
                    className="icon-button"
                    title="Settings"
                    onClick={onSettings}
                    aria-label="Settings"
                >
                    <Ico.Settings size={13} />
                </button>
            </div>
        </div>
    );
}
