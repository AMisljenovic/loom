import { useEffect, useRef, useState } from "react";
import * as Ico from "../../brand/icons";

interface CopyButtonProps {
    text: string;
    label?: string;
}

// Copies the given text to the system clipboard with a short "Copied"
// confirmation. Uses navigator.clipboard when available and falls back to
// a hidden <textarea> + document.execCommand("copy") for VS Code webviews
// where the async Clipboard API can be blocked by the host's permission
// policy.
export async function copyToClipboard(text: string): Promise<boolean> {
    if (!text) return false;
    try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // fall through to execCommand fallback
    }
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        ta.style.pointerEvents = "none";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}

export function CopyButton({ text, label = "Copy" }: CopyButtonProps) {
    const [copied, setCopied] = useState(false);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (timerRef.current !== null) {
                window.clearTimeout(timerRef.current);
            }
        };
    }, []);

    const onClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        const ok = await copyToClipboard(text);
        if (!ok) return;
        setCopied(true);
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCopied(false), 1400);
    };

    return (
        <button
            type="button"
            className={`copy-btn${copied ? " copied" : ""}`}
            onClick={onClick}
            aria-label={copied ? "Copied" : label}
            title={copied ? "Copied" : label}
        >
            {copied ? <Ico.Check size={11} /> : <Ico.Copy size={11} />}
            <span>{copied ? "Copied" : label}</span>
        </button>
    );
}
