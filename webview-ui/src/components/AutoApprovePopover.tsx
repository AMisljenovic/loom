import { useMemo } from "react";
import type { AutoApproveCategory, AutoApproveConfig } from "../../../src/shared/protocol";
import * as Ico from "../brand/icons";
import { post } from "../vscode";

const ROWS: { id: AutoApproveCategory; label: string; description: string; disabled?: boolean }[] = [
    { id: "read", label: "Read", description: "Inspect files, search, diagnostics" },
    { id: "write", label: "Write", description: "Apply diffs and create files" },
    { id: "mcp", label: "MCP", description: "Tools exposed by MCP servers" },
    { id: "mode", label: "Mode", description: "Switch modes from natural language" },
    { id: "subtasks", label: "Subtasks", description: "Spawn delegate agents (coming soon)", disabled: true },
    { id: "execute", label: "Execute", description: "Run shell commands (blocking + background)" },
    { id: "question", label: "Question", description: "Auto-accept the model's default for clarifying questions" },
];

interface AutoApprovePopoverProps {
    config: AutoApproveConfig;
    onClose: () => void;
}

export function AutoApprovePopover({ config, onClose }: AutoApprovePopoverProps) {
    const anyOn = useMemo(
        () => Object.values(config.categories).some(Boolean),
        [config.categories],
    );

    const set = (next: AutoApproveConfig) => post({ type: "setAutoApprove", config: next });

    const toggleCategory = (id: AutoApproveCategory) => {
        set({
            ...config,
            categories: { ...config.categories, [id]: !config.categories[id] },
        });
    };

    const all = () => set({
        enabled: true,
        categories: Object.fromEntries(ROWS.map((r) => [r.id, !r.disabled])) as AutoApproveConfig["categories"],
    });
    const none = () => set({
        ...config,
        categories: Object.fromEntries(ROWS.map((r) => [r.id, false])) as AutoApproveConfig["categories"],
    });
    const toggleEnabled = () => set({ ...config, enabled: !config.enabled });

    return (
        <div className="popover auto-approve-pop" role="dialog" aria-label="Auto-approve">
            <div className="pop-head">
                <strong>Auto-approve</strong>
                <button className="icon-button" onClick={onClose} aria-label="Close">
                    <Ico.Close size={12} />
                </button>
            </div>
            <div className="pop-sub">
                Run these actions without asking for permission. Only enable for actions you fully trust.
            </div>
            <div className="auto-approve-rows">
                {ROWS.map((row) => {
                    const on = !!config.categories[row.id] && !row.disabled;
                    return (
                        <button
                            key={row.id}
                            className={`auto-approve-row${on ? " on" : ""}${row.disabled ? " disabled" : ""}`}
                            onClick={() => !row.disabled && toggleCategory(row.id)}
                            title={row.description}
                            disabled={row.disabled}
                            aria-pressed={on}
                        >
                            <span className="auto-approve-glyph"><CategoryGlyph id={row.id} /></span>
                            <span className="auto-approve-label">{row.label}</span>
                        </button>
                    );
                })}
            </div>
            <div className="pop-foot">
                <button className="ghost-btn" onClick={all}>
                    <Ico.Check size={11} /> All
                </button>
                <button className="ghost-btn" onClick={none}>
                    <Ico.Close size={11} /> None
                </button>
                <span style={{ flex: 1 }} />
                <button
                    className={`toggle-btn${config.enabled && anyOn ? " on" : ""}`}
                    onClick={toggleEnabled}
                    aria-pressed={config.enabled}
                >
                    {config.enabled ? "Enabled" : "Disabled"}
                </button>
            </div>
        </div>
    );
}

function CategoryGlyph({ id }: { id: AutoApproveCategory }) {
    switch (id) {
        case "read": return <Ico.Ask size={12} />;
        case "write": return <Ico.Code size={12} />;
        case "mcp": return <Ico.Spark size={12} />;
        case "mode": return <Ico.Compass size={12} />;
        case "subtasks": return <Ico.Code size={12} />;
        case "execute": return <Ico.Bug size={12} />;
        case "question": return <Ico.Ask size={12} />;
    }
}

// Returns the pill label/state for the status-bar trigger.
export function autoApprovePillLabel(config: AutoApproveConfig): { label: string; on: boolean } {
    if (!config.enabled) return { label: "auto-approve off", on: false };
    const anyOn = Object.values(config.categories).some(Boolean);
    if (!anyOn) return { label: "auto-approve off", on: false };
    return { label: "auto-approve on", on: true };
}
