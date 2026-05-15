import { useState } from "react";
import type { AlwaysAllowRule, Msg } from "../../../../src/shared/protocol";
import * as Ico from "../../brand/icons";
import { inputString, isPathTool, makeCommandRule, makePathRule, makeToolRule } from "../../util/rules";
import { post } from "../../vscode";

interface ApprovalActionsProps {
    msg: Extract<Msg, { role: "tool" }>;
}

export function ApprovalActions({ msg }: ApprovalActionsProps) {
    const [done, setDone] = useState(false);
    if (done || msg.status !== "pending") return null;

    const { callId, name: toolName, input } = msg;

    const command = inputString(input, "command");
    const path = inputString(input, "path");

    const approve = (rememberRule?: AlwaysAllowRule, sessionCount?: number) => {
        post({ type: "approve", callId, approved: true, rememberRule, sessionCount });
        setDone(true);
    };

    const reject = () => {
        post({ type: "approve", callId, approved: false });
        setDone(true);
    };

    return (
        <div className="approval-panel">
            <div className="approval-prompt">
                Allow <strong>{toolName}</strong>?
            </div>
            <div className="approval-actions">
                <button className="btn-approve" onClick={() => approve()}>
                    <Ico.Check size={12} /> Approve
                </button>
                <button className="btn-reject" onClick={reject}>
                    <Ico.Close size={12} /> Reject
                </button>
                <button className="btn-remember" onClick={() => approve(makeToolRule(toolName))} title={`Always allow ${toolName}`}>
                    Always allow {toolName}
                </button>
                {toolName === "run_command" && command && (
                    <button className="btn-remember" onClick={() => approve(makeCommandRule(command))} title={`Always allow: ${command}`}>
                        Always allow cmd
                    </button>
                )}
                {isPathTool(toolName) && path && (
                    <button className="btn-remember" onClick={() => approve(makePathRule(toolName, path))} title={`Always allow path: ${path}`}>
                        Always allow path
                    </button>
                )}
                <button className="btn-remember secondary" onClick={() => approve(undefined, 5)} title="Approve next 5 tool calls">
                    Approve next 5
                </button>
            </div>
        </div>
    );
}
