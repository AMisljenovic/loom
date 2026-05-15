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
                <div className="pop-empty">No rules yet. Use the approval flow to add rules.</div>
            ) : (
                <ul className="allowlist-list">
                    {rules.map((rule) => (
                        <li key={rule.id} className="allowlist-item">
                            <div className="al-tool">{rule.tool}</div>
                            <div className="al-scope">{formatRule(rule)}</div>
                            <button
                                className="icon-button al-remove"
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
