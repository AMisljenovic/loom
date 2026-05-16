import * as Ico from "../../brand/icons";

interface SettingsPopoverProps {
    onClose: () => void;
}

export function SettingsPopover({ onClose }: SettingsPopoverProps) {
    return (
        <div className="popover settings-pop">
            <div className="pop-head">
                <span>Settings</span>
                <button className="icon-button" onClick={onClose} aria-label="Close">
                    <Ico.Close size={12} />
                </button>
            </div>
            <div className="pop-body">
                <div className="settings-note">
                    Auto-approve has moved to its own pill in the toolbar. Click <strong>auto-approve on</strong>/<strong>auto-approve off</strong>
                    {" "}to manage per-category permissions.
                </div>
            </div>
        </div>
    );
}
