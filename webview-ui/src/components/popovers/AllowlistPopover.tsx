import type { AlwaysAllowRule } from "../../../../src/shared/protocol";
import * as Ico from "../../brand/icons";
import { formatRule } from "../../util/rules";
import { post } from "../../vscode";

interface AllowlistPopoverProps {
    rules: AlwaysAllowRule[];
    onClose: () => void;
}

export function AllowlistPopover({ rules, onClose }: AllowlistPopoverProps) {
    return (
        <div className="popover allowlist">
            <div className="pop-head">
                <span>Always-allow rules</span>
                <button className="icon-button" onClick={onClose} aria-label="Close">
                    <Ico.Close size={12} />
                </button>
            </div>
            {rules.length === 0 ? (
                <div className="allow-empty">No rules yet. Use the approval flow to add rules.</div>
            ) : (
                <ul className="allow-list">
                    {rules.map((rule) => (
                        <li key={rule.id} className="allow-rule">
                            <div>
                                <div className="ar-name">{rule.tool}</div>
                                <div className="ar-scope">{formatRule(rule)}</div>
                            </div>
                            <button
                                className="allow-del"
                                onClick={() => post({ type: "removeAlwaysAllowRule", id: rule.id })}
                                title="Remove rule"
                                aria-label="Remove rule"
                            >
                                <Ico.Trash size={12} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
