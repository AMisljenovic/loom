import * as Ico from "../../brand/icons";
import { post } from "../../vscode";

interface SettingsPopoverProps {
    autoApprove: boolean;
    onClose: () => void;
}

export function SettingsPopover({ autoApprove, onClose }: SettingsPopoverProps) {
    return (
        <div className="popover settings-pop">
            <div className="pop-head">
                <span>Settings</span>
                <button className="icon-button" onClick={onClose} aria-label="Close">
                    <Ico.Close size={12} />
                </button>
            </div>
            <div className="pop-body">
                <div className="settings-row">
                    <span className="settings-label">Auto-approve all tools</span>
                    <button
                        className={`toggle-btn${autoApprove ? " on" : ""}`}
                        onClick={() => post({ type: "setAutoApprove", enabled: !autoApprove })}
                        aria-pressed={autoApprove}
                    >
                        {autoApprove ? "On" : "Off"}
                    </button>
                </div>
                <div className="settings-note">
                    When on, all approval-gated tools run without prompting. Use with caution.
                </div>
            </div>
        </div>
    );
}
