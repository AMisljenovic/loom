import React, { useEffect, useRef } from "react";
import * as Ico from "../../brand/icons";
import { post } from "../../vscode";

export interface LiveTaskStatus {
    phase: "thinking" | "responding" | "reading" | "executing" | "changing" | "researching" | "waiting";
    label: string;
    detail?: string;
}

interface InputAreaProps {
    busy: boolean;
    input: string;
    onInput: (value: string) => void;
    onSubmit: () => void;
    status?: LiveTaskStatus | null;
    disabled?: boolean;
}

export function InputArea({ busy, input, onInput, onSubmit, status, disabled }: InputAreaProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

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
            {busy && status && <TaskStatus status={status} />}
            <div className="composer">
                <textarea
                    ref={textareaRef}
                    className="composer-input"
                    value={input}
                    onChange={(e) => onInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={busy ? `${status?.label ?? "Working"}...` : "Message Loom (Shift+Enter for newline)"}
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

function TaskStatus({ status }: { status: LiveTaskStatus }) {
    return (
        <div className={`task-status task-status-${status.phase}`} role="status" aria-live="polite">
            <div className="task-status-motion" aria-hidden="true">
                <span />
                <span />
                <span />
            </div>
            <div className="task-status-copy">
                <span className="task-status-label">{status.label}</span>
                {status.detail && <span className="task-status-detail">{status.detail}</span>}
            </div>
        </div>
    );
}
