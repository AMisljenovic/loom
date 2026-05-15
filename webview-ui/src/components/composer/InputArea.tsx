import React, { useEffect, useRef } from "react";
import * as Ico from "../../brand/icons";
import { post } from "../../vscode";

interface InputAreaProps {
    busy: boolean;
    input: string;
    onInput: (value: string) => void;
    onSubmit: () => void;
    disabled?: boolean;
}

export function InputArea({ busy, input, onInput, onSubmit, disabled }: InputAreaProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }, [input]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (input.trim()) onSubmit();
        }
    };

    const canSubmit = input.trim().length > 0;

    return (
        <div className="input-area">
            <div className="composer">
                <textarea
                    ref={textareaRef}
                    className="composer-input"
                    value={input}
                    onChange={(e) => onInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={busy ? "Responding…" : "Message Loom (Shift+Enter for newline)"}
                    rows={1}
                    disabled={disabled}
                    aria-label="Message input"
                />
                {busy ? (
                    <button
                        className="send-btn stop-btn"
                        onClick={() => post({ type: "cancel" })}
                        title="Cancel"
                        aria-label="Cancel"
                    >
                        <Ico.Stop size={13} />
                    </button>
                ) : (
                    <button
                        className="send-btn"
                        onClick={onSubmit}
                        disabled={!canSubmit || disabled}
                        title="Send (Enter)"
                        aria-label="Send"
                    >
                        <Ico.Send size={13} />
                    </button>
                )}
            </div>
        </div>
    );
}
