import * as Ico from "../../brand/icons";
import { post } from "../../vscode";

interface OpenInEditorButtonProps {
    id: string;
    title: string;
    content: string;
    language?: string;
    label?: string;
}

export function OpenInEditorButton({ id, title, content, language, label = "Open in editor" }: OpenInEditorButtonProps) {
    const onClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!content) return;
        post({ type: "openInEditor", id, title, content, language });
    };

    return (
        <button
            type="button"
            className="copy-btn"
            onClick={onClick}
            aria-label={label}
            title={label}
        >
            <Ico.OpenExternal size={11} />
            <span>Open</span>
        </button>
    );
}
