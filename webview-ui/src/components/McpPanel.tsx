import type { McpServerStatus } from "../../../src/shared/protocol";
import * as Ico from "../brand/icons";
import { post } from "../vscode";

interface McpPanelProps {
    statuses: McpServerStatus[];
    onClose: () => void;
}

export function McpPanel({ statuses, onClose }: McpPanelProps) {
    return (
        <div className="convo-list workflow-panel mcp-panel">
            <div className="convo-list-head">
                <span>MCP servers</span>
                <div className="convo-head-actions">
                    <button className="convo-new" onClick={() => post({ type: "mcpReload" })} title="Reload all MCP servers from .vscode/mcp.json">
                        <Ico.Spark size={11} />
                        Reload
                    </button>
                    <button className="convo-new" onClick={onClose}>Close</button>
                </div>
            </div>
            {statuses.length === 0 ? (
                <div className="workflow-empty">No MCP servers configured. Add servers to <code>.vscode/mcp.json</code>.</div>
            ) : statuses.map((status) => (
                <div className="workflow-row" key={status.server}>
                    <div className="workflow-main">
                        <div className="workflow-title">
                            <span className={`mcp-state mcp-state-${status.state}`}>{status.state}</span>
                            {" "}
                            {status.server}
                        </div>
                        <div className="workflow-meta">
                            {typeof status.toolCount === "number" && <span>{status.toolCount} tool{status.toolCount === 1 ? "" : "s"}</span>}
                            {typeof status.attempt === "number" && status.attempt > 1 && <span>attempt {status.attempt}</span>}
                            {status.message && <span title={status.message}>{truncate(status.message, 80)}</span>}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function truncate(s: string, max: number): string {
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
