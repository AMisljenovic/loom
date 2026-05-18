import React, { useRef, useState } from "react";
import type {
    AlwaysAllowRule,
    AutoApproveConfig,
    ConversationUsage,
    IndexStatusNotify,
    LlmConfigView,
    McpServerStatus,
    ModeDefinition,
} from "../../../../src/shared/protocol";
import { autoApprovePillLabel } from "../AutoApprovePopover";
import * as Ico from "../../brand/icons";
import { formatTokens } from "../../util/format";
import { post } from "../../vscode";
import { estimateCost } from "../../../../src/shared/pricing";

interface WorkspaceFolderInfo {
    uri: string;
    name: string;
}

interface ToolbarProps {
    llmConfig: LlmConfigView | null;
    usage: ConversationUsage | null;
    mcpStatuses: McpServerStatus[];
    indexStatus: IndexStatusNotify | null;
    modes: ModeDefinition[];
    currentModeId: string;
    alwaysAllowRules: AlwaysAllowRule[];
    autoApprove: AutoApproveConfig;
    workspaceFolders: WorkspaceFolderInfo[];
    activeWorkspaceFolderUri: string;
    onShowAllowlist: () => void;
    onShowModel: () => void;
    onShowAutoApprove: () => void;
    onShowMcp: () => void;
    onShowSearch: () => void;
}

export function Toolbar({
    llmConfig,
    usage,
    mcpStatuses,
    indexStatus,
    modes,
    currentModeId,
    alwaysAllowRules,
    autoApprove,
    workspaceFolders,
    activeWorkspaceFolderUri,
    onShowAllowlist,
    onShowModel,
    onShowAutoApprove,
    onShowMcp,
    onShowSearch,
}: ToolbarProps) {
    const pill = autoApprovePillLabel(autoApprove);
    const [modeOpen, setModeOpen] = useState(false);
    const [folderOpen, setFolderOpen] = useState(false);
    const modeRef = useRef<HTMLDivElement>(null);
    const folderRef = useRef<HTMLDivElement>(null);

    const currentMode = modes.find((m) => m.id === currentModeId);
    const activeFolder = workspaceFolders.find((f) => f.uri === activeWorkspaceFolderUri) ?? workspaceFolders[0];

    return (
        <div className="toolbar">
            {/* Mode selector */}
            <div className="toolbar-section" ref={modeRef} style={{ position: "relative" }}>
                <button
                    className="mode-select-btn"
                    onClick={() => setModeOpen((v) => !v)}
                    title="Switch mode"
                >
                    <ModeGlyph mode={currentMode} />
                    <span>{currentMode?.label ?? currentModeId}</span>
                    <Ico.ChevDn size={9} />
                </button>
                {modeOpen && (
                    <ModeDropdown
                        modes={modes}
                        currentModeId={currentModeId}
                        onPick={(id) => {
                            post({ type: "setMode", modeId: id });
                            setModeOpen(false);
                        }}
                        onClose={() => setModeOpen(false)}
                        anchorRef={modeRef}
                    />
                )}
            </div>

            {/* Workspace folder selector */}
            {workspaceFolders.length > 1 && activeFolder && (
                <div className="toolbar-section" ref={folderRef} style={{ position: "relative" }}>
                    <button
                        className="mode-select-btn"
                        onClick={() => setFolderOpen((v) => !v)}
                        title={`Active workspace folder: ${activeFolder.name}`}
                    >
                        <Ico.Folder size={11} />
                        <span>{activeFolder.name}</span>
                        <Ico.ChevDn size={9} />
                    </button>
                    {folderOpen && (
                        <div className="mode-picker">
                            {workspaceFolders.map((f) => (
                                <button
                                    key={f.uri}
                                    className={`mode-item${f.uri === activeFolder.uri ? " active" : ""}`}
                                    onClick={() => {
                                        post({ type: "setWorkspaceFolder", uri: f.uri });
                                        setFolderOpen(false);
                                    }}
                                >
                                    <span className="mode-glyph"><Ico.Folder size={12} /></span>
                                    <span className="mode-label">{f.name}</span>
                                    {f.uri === activeFolder.uri && <Ico.Check size={11} className="mode-check" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="toolbar-spacer" />

            {/* Index status */}
            {indexStatus && indexStatus.state !== "disabled" && (
                <button
                    className="index-status"
                    title={`Index: ${indexStatus.state} — ${indexStatus.filesScanned} files, ${indexStatus.symbolsCount} symbols. Click to search.`}
                    onClick={onShowSearch}
                >
                    <span className={`status-dot ${indexStatus.state}`} />
                </button>
            )}

            {/* MCP status */}
            {mcpStatuses.length > 0 && (
                <button
                    className="mcp-status"
                    onClick={onShowMcp}
                    title={`MCP: ${mcpStatuses.map((s) => `${s.server}:${s.state}`).join(", ")}. Click to manage.`}
                >
                    <Ico.Spark size={11} />
                    <span className="mcp-count">
                        {mcpStatuses.filter((s) => s.state === "ready").length}/{mcpStatuses.length}
                    </span>
                </button>
            )}

            {/* Token meter */}
            {usage && (usage.inputTokens > 0 || usage.outputTokens > 0) && (
                <div className="token-meter" title={usageTitle(usage)}>
                    <Ico.Code size={11} />
                    <span className="tm-item">in {formatTokens(totalInput(usage))}</span>
                    <span className="tm-arrow">/</span>
                    <span className="tm-item">out {formatTokens(totalOutput(usage))}</span>
                    {formatCost(estimateCost(usage)) && (
                        <>
                            <span className="tm-arrow">/</span>
                            <span className="tm-item">{formatCost(estimateCost(usage))}</span>
                        </>
                    )}
                    {usage.subAgentCount ? <span className="token-sub">+{usage.subAgentCount} research</span> : null}
                </div>
            )}

            {/* Model pill */}
            <button className="model-pill" onClick={onShowModel} title="Model settings">
                {llmConfig?.model ? shortModel(llmConfig.model) : "—"}
            </button>

            {/* Always-allow indicator */}
            {alwaysAllowRules.length > 0 && (
                <button
                    className="toggle-btn"
                    onClick={onShowAllowlist}
                    title={`${alwaysAllowRules.length} always-allow rule${alwaysAllowRules.length > 1 ? "s" : ""}`}
                >
                    <Ico.Check size={11} />
                    <span>{alwaysAllowRules.length}</span>
                </button>
            )}

            {/* Auto-approve pill */}
            <button
                className={`toggle-btn${pill.on ? " on" : ""}`}
                onClick={onShowAutoApprove}
                title="Auto-approve settings"
            >
                <Ico.Check size={11} />
                <span>{pill.label}</span>
            </button>
        </div>
    );
}

function usageTitle(usage: ConversationUsage): string {
    const subIn = usage.subAgentInputTokens ?? 0;
    const subOut = usage.subAgentOutputTokens ?? 0;
    const parts = [
        `Main input: ${usage.inputTokens}`,
        `Main output: ${usage.outputTokens}`,
        `Total input: ${totalInput(usage)}`,
        `Total output: ${totalOutput(usage)}`,
    ];
    if (subIn || subOut) {
        parts.push(`Sub-agents input: ${subIn}`, `Sub-agents output: ${subOut}`);
    }
    const cost = formatCost(estimateCost(usage));
    if (cost) parts.push(`Estimated cost: ${cost}`);
    if (usage.model) parts.push(`Model: ${usage.model}`);
    if (usage.promptVersion) parts.push(`Prompt: ${usage.promptVersion}`);
    return parts.join(" / ");
}

function totalInput(usage: ConversationUsage): number {
    return usage.inputTokens + (usage.subAgentInputTokens ?? 0);
}

function totalOutput(usage: ConversationUsage): number {
    return usage.outputTokens + (usage.subAgentOutputTokens ?? 0);
}

function formatCost(cost: number | undefined): string | undefined {
    if (cost === undefined) return undefined;
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
}

function shortModel(model: string): string {
    if (model.includes("claude-3-5")) return "3.5";
    if (model.includes("claude-3-7")) return "3.7";
    if (model.includes("claude")) {
        const m = /claude-(\d[-\w]*)/.exec(model);
        return m ? m[1].slice(0, 8) : model.slice(0, 8);
    }
    if (model.includes("gpt-4o")) return "4o";
    if (model.includes("gpt-4")) return "gpt4";
    if (model.includes("gpt-3")) return "gpt3";
    return model.length > 10 ? `${model.slice(0, 8)}…` : model;
}

function ModeGlyph({ mode }: { mode: ModeDefinition | undefined }) {
    switch (mode?.id) {
        case "code": return <Ico.Code size={12} />;
        case "ask": return <Ico.Ask size={12} />;
        case "debug": return <Ico.Bug size={12} />;
        case "architect": return <Ico.Compass size={12} />;
        default: return <Ico.Spark size={12} />;
    }
}

interface ModeDropdownProps {
    modes: ModeDefinition[];
    currentModeId: string;
    onPick: (id: string) => void;
    onClose: () => void;
    anchorRef: React.RefObject<HTMLDivElement | null>;
}

function ModeDropdown({ modes, currentModeId, onPick }: ModeDropdownProps) {
    return (
        <div className="mode-picker">
            {modes.map((m) => (
                <button
                    key={m.id}
                    className={`mode-item${m.id === currentModeId ? " active" : ""}`}
                    onClick={() => onPick(m.id)}
                >
                    <span className="mode-glyph"><ModeGlyph mode={m} /></span>
                    <span className="mode-label">{m.label}</span>
                    {m.id === currentModeId && <Ico.Check size={11} className="mode-check" />}
                </button>
            ))}
        </div>
    );
}
