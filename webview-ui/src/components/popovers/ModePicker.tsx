import type { ModeDefinition } from "../../../../src/shared/protocol";
import * as Ico from "../../brand/icons";
import { post } from "../../vscode";

interface ModePickerProps {
    modes: ModeDefinition[];
    currentModeId: string;
    onClose: () => void;
}

export function ModePicker({ modes, currentModeId, onClose }: ModePickerProps) {
    return (
        <div className="popover mode-picker-pop">
            <div className="pop-head">
                <span>Agent mode</span>
                <button className="icon-button" onClick={onClose} aria-label="Close">
                    <Ico.Close size={12} />
                </button>
            </div>
            <div className="mode-list">
                {modes.map((m) => (
                    <button
                        key={m.id}
                        className={`mode-item${m.id === currentModeId ? " active" : ""}`}
                        onClick={() => {
                            post({ type: "setMode", modeId: m.id });
                            onClose();
                        }}
                    >
                        <span className="mode-label">{m.label}</span>
                        {m.id === currentModeId && <Ico.Check size={12} className="mode-check" />}
                    </button>
                ))}
            </div>
        </div>
    );
}
