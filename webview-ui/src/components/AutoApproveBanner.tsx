import * as Ico from "../brand/icons";

interface AutoApproveBannerProps {
    onDisable: () => void;
}

export function AutoApproveBanner({ onDisable }: AutoApproveBannerProps) {
    return (
        <div className="banner warn">
            <Ico.Warn size={13} className="banner-icon" />
            <div className="banner-body">
                <strong>Auto-approve is on.</strong>{" "}
                <span>Approval-gated tools will run without prompting.</span>
            </div>
            <button className="banner-close icon-button" onClick={onDisable} title="Disable auto-approve" aria-label="Disable auto-approve">
                <Ico.Close size={11} />
            </button>
        </div>
    );
}
