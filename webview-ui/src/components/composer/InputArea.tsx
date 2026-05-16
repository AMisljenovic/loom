import React, { useEffect, useRef, useState } from "react";
import type { ReferenceAttachment } from "../../../../src/shared/protocol";
import * as Ico from "../../brand/icons";
import { parseAtQuery, replaceAtQuery } from "../../util/atMention";
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
    hint?: string;
    references?: ReferenceAttachment[];
    onAddReference?: () => void;
    onRemoveReference?: (id: string) => void;
    onDirectReference?: (ref: ReferenceAttachment) => void;
}

export function InputArea({
    busy,
    input,
    onInput,
    onSubmit,
    status,
    disabled,
    hint,
    references = [],
    onAddReference,
    onRemoveReference,
    onDirectReference,
}: InputAreaProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const requestIdRef = useRef(0);
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [suggestions, setSuggestions] = useState<ReferenceAttachment[]>([]);
    const [atQuery, setAtQuery] = useState<{ query: string; start: number; end: number } | null>(null);
    const [selectedIdx, setSelectedIdx] = useState(0);

    // Auto-resize textarea
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }, [input]);

    // Listen for suggestion replies from the host
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const m = event.data as { type?: string; requestId?: string; suggestions?: ReferenceAttachment[] };
            if (m?.type === "referenceSuggestions" && m.requestId === String(requestIdRef.current)) {
                setSuggestions(m.suggestions ?? []);
                setSelectedIdx(0);
            }
        };
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, []);

    function closeSuggestions() {
        setSuggestions([]);
        setAtQuery(null);
        setSelectedIdx(0);
        if (searchTimerRef.current !== null) {
            clearTimeout(searchTimerRef.current);
            searchTimerRef.current = null;
        }
    }

    function updateAtQuery(value: string, cursor: number | null, refs: ReferenceAttachment[]) {
        const pos = cursor ?? value.length;
        const parsed = parseAtQuery(value, pos);
        if (!parsed) {
            setAtQuery(null);
            setSuggestions([]);
            return;
        }
        setAtQuery(parsed);
        if (searchTimerRef.current !== null) clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(() => {
            searchTimerRef.current = null;
            requestIdRef.current += 1;
            post({ type: "referenceSearch", requestId: String(requestIdRef.current), query: parsed.query, existing: refs });
        }, 150);
    }

    function selectSuggestion(ref: ReferenceAttachment) {
        if (!atQuery) return;
        onInput(replaceAtQuery(input, atQuery.start, atQuery.end));
        onDirectReference?.(ref);
        closeSuggestions();
        setTimeout(() => textareaRef.current?.focus(), 0);
    }

    const canSubmit = input.trim().length > 0 || references.length > 0;

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (suggestions.length > 0 && atQuery) {
            if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1)); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); selectSuggestion(suggestions[selectedIdx]); return; }
            if (e.key === "Escape") { e.preventDefault(); closeSuggestions(); return; }
        }
        if (atQuery && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
            closeSuggestions();
        }
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canSubmit) onSubmit();
        }
    };

    return (
        <div className="input-area">
            {busy && status && <TaskStatus status={status} />}
            <div className="composer">
                {suggestions.length > 0 && atQuery && (
                    <div className="sug-popover" role="listbox" aria-label="File suggestions">
                        {suggestions.map((ref, i) => (
                            <div
                                key={ref.id}
                                className={`sug-item${i === selectedIdx ? " active" : ""}`}
                                role="option"
                                aria-selected={i === selectedIdx}
                                onMouseDown={(e) => { e.preventDefault(); selectSuggestion(ref); }}
                            >
                                <span className="sug-icon">
                                    {ref.kind === "folder" ? <Ico.Folder size={13} /> : <Ico.File size={13} />}
                                </span>
                                <span className="sug-label">{ref.label ?? ref.path.split("/").pop()}</span>
                                <span className="sug-path">{ref.path}</span>
                            </div>
                        ))}
                    </div>
                )}
                {references.length > 0 && (
                    <div className="reference-chips" aria-label="References">
                        {references.map((ref) => (
                            <span className={`reference-chip ref-${ref.kind}`} key={ref.id} title={`${ref.kind}: ${ref.path}`}>
                                <Ico.File size={12} />
                                <span>{ref.label || ref.path}</span>
                                <button
                                    type="button"
                                    onClick={() => onRemoveReference?.(ref.id)}
                                    title={`Remove ${ref.path}`}
                                    aria-label={`Remove ${ref.path}`}
                                >
                                    <Ico.Close size={10} />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
                <textarea
                    ref={textareaRef}
                    className="composer-input"
                    value={input}
                    onChange={(e) => {
                        onInput(e.target.value);
                        updateAtQuery(e.target.value, e.target.selectionStart, references);
                    }}
                    onSelect={(e) => {
                        if (!atQuery) return;
                        const target = e.target as HTMLTextAreaElement;
                        if (!parseAtQuery(target.value, target.selectionStart)) {
                            closeSuggestions();
                        }
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={busy ? `${status?.label ?? "Working"}...` : (hint ?? "Message Loom (@ for files, Shift+Enter for newline)")}
                    rows={1}
                    disabled={disabled}
                    aria-label="Message input"
                    aria-autocomplete="list"
                    aria-expanded={suggestions.length > 0}
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
                    <div className="composer-actions">
                        <button
                            className="attach-btn"
                            onClick={onAddReference}
                            disabled={disabled}
                            title="Add file or folder reference"
                            aria-label="Add file or folder reference"
                        >
                            <Ico.Plus size={13} />
                        </button>
                        <button
                            className="send-btn"
                            onClick={onSubmit}
                            disabled={!canSubmit || disabled}
                            title="Send (Enter)"
                            aria-label="Send"
                        >
                            <Ico.Send size={13} />
                        </button>
                    </div>
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
