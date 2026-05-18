import React, { useEffect, useRef, useState } from "react";
import type { CommandCatalogueEntry, ReferenceAttachment, ReferencePacksIndex } from "../../../../src/shared/protocol";
import * as Ico from "../../brand/icons";
import { parseAtQuery, replaceAtQuery } from "../../util/atMention";
import { clipboardHasSupportedImage, imageReferencesFromClipboardData } from "../../util/imageReference";
import { post } from "../../vscode";
import { CommandPalette } from "../CommandPalette";

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
    packs?: ReferencePacksIndex;
    commands?: CommandCatalogueEntry[];
    onAddReference?: () => void;
    onRemoveReference?: (id: string) => void;
    onDirectReference?: (ref: ReferenceAttachment) => void;
    onSavePack?: (name: string) => void;
    onApplyPack?: (id: string, mode?: "merge" | "replace") => void;
    onDeletePack?: (id: string) => void;
    onRenamePack?: (id: string, name: string) => void;
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
    packs,
    commands = [],
    onAddReference,
    onRemoveReference,
    onDirectReference,
    onSavePack,
    onApplyPack,
    onDeletePack,
    onRenamePack,
}: InputAreaProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const requestIdRef = useRef(0);
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [suggestions, setSuggestions] = useState<ReferenceAttachment[]>([]);
    const [atQuery, setAtQuery] = useState<{ query: string; start: number; end: number } | null>(null);
    const [selectedIdx, setSelectedIdx] = useState(0);
    const [selectedCommandIdx, setSelectedCommandIdx] = useState(0);
    const [showPacks, setShowPacks] = useState(false);
    const [savePromptOpen, setSavePromptOpen] = useState(false);
    const [packDraft, setPackDraft] = useState("");
    const [packRenameId, setPackRenameId] = useState<string | null>(null);
    const [packRenameDraft, setPackRenameDraft] = useState("");

    const orderedPacks = packs
        ? packs.order.map((id) => packs.packs[id]).filter((p): p is NonNullable<typeof p> => !!p)
        : [];
    const packMatches = atQuery
        ? orderedPacks.filter((p) => p.name.toLowerCase().includes(atQuery.query.toLowerCase()))
        : [];
    const commandQuery = commandQueryFor(input);
    const commandMatches = commandQuery === undefined
        ? []
        : commands.filter((command) => command.name.toLowerCase().startsWith(commandQuery.toLowerCase()));

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
        if (ref.kind === "image") return;
        if (!atQuery) return;
        onInput(replaceAtQuery(input, atQuery.start, atQuery.end));
        onDirectReference?.(ref);
        closeSuggestions();
        setTimeout(() => textareaRef.current?.focus(), 0);
    }

    function selectPack(packId: string) {
        if (atQuery) {
            onInput(replaceAtQuery(input, atQuery.start, atQuery.end));
        }
        onApplyPack?.(packId, "merge");
        closeSuggestions();
        setTimeout(() => textareaRef.current?.focus(), 0);
    }

    function selectCommand(command: CommandCatalogueEntry) {
        onInput(`/${command.name} `);
        setSelectedCommandIdx(0);
        setTimeout(() => textareaRef.current?.focus(), 0);
    }

    function commitSavePack() {
        const name = packDraft.trim();
        if (name) {
            onSavePack?.(name);
        }
        setPackDraft("");
        setSavePromptOpen(false);
    }

    function commitRenamePack(id: string) {
        const name = packRenameDraft.trim();
        if (name) {
            onRenamePack?.(id, name);
        }
        setPackRenameId(null);
        setPackRenameDraft("");
    }

    const totalSuggestions = suggestions.length + packMatches.length;

    const canSubmit = input.trim().length > 0 || references.length > 0;

    async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
        if (!clipboardHasSupportedImage(e.clipboardData)) return;
        e.preventDefault();
        const existingImages = references.filter((ref) => ref.kind === "image").length;
        const refs = await imageReferencesFromClipboardData(e.clipboardData, existingImages);
        for (const ref of refs) onDirectReference?.(ref);
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (commandMatches.length > 0) {
            if (e.key === "ArrowDown") { e.preventDefault(); setSelectedCommandIdx((i) => Math.min(i + 1, commandMatches.length - 1)); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setSelectedCommandIdx((i) => Math.max(i - 1, 0)); return; }
            if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                selectCommand(commandMatches[Math.min(selectedCommandIdx, commandMatches.length - 1)]);
                return;
            }
            if (e.key === "Escape") { e.preventDefault(); setSelectedCommandIdx(0); return; }
        }
        if (totalSuggestions > 0 && atQuery) {
            if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, totalSuggestions - 1)); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); return; }
            if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                if (selectedIdx < packMatches.length) {
                    selectPack(packMatches[selectedIdx].id);
                } else {
                    selectSuggestion(suggestions[selectedIdx - packMatches.length]);
                }
                return;
            }
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
            {showPacks && (
                <div className="packs-panel" role="region" aria-label="Saved reference packs">
                    <div className="packs-head">
                        <span>Reference packs</span>
                        <button className="btn btn-sm" onClick={() => setShowPacks(false)}>Close</button>
                    </div>
                    {orderedPacks.length === 0 ? (
                        <div className="packs-empty">No saved packs yet. Add references and click "Save as pack".</div>
                    ) : (
                        orderedPacks.map((pack) => (
                            <div className="pack-row" key={pack.id}>
                                <div className="pack-main">
                                    {packRenameId === pack.id ? (
                                        <input
                                            className="pack-rename-input"
                                            autoFocus
                                            value={packRenameDraft}
                                            onChange={(e) => setPackRenameDraft(e.target.value)}
                                            onBlur={() => commitRenamePack(pack.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") commitRenamePack(pack.id);
                                                else if (e.key === "Escape") { setPackRenameId(null); setPackRenameDraft(""); }
                                            }}
                                        />
                                    ) : (
                                        <span className="pack-name">{pack.name}</span>
                                    )}
                                    <span className="pack-meta">{pack.refs.length} item{pack.refs.length === 1 ? "" : "s"}</span>
                                </div>
                                <div className="pack-actions">
                                    <button className="btn btn-sm" onClick={() => { onApplyPack?.(pack.id, "merge"); setShowPacks(false); }}>Apply</button>
                                    <button className="btn btn-sm" onClick={() => { onApplyPack?.(pack.id, "replace"); setShowPacks(false); }} title="Replace current references">Replace</button>
                                    <button className="btn btn-sm" onClick={() => { setPackRenameId(pack.id); setPackRenameDraft(pack.name); }}>Rename</button>
                                    <button className="btn btn-sm danger" onClick={() => onDeletePack?.(pack.id)}>Delete</button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
            <div className="composer">
                {commandMatches.length > 0 && (
                    <CommandPalette
                        commands={commandMatches}
                        selectedIndex={Math.min(selectedCommandIdx, commandMatches.length - 1)}
                        onSelect={selectCommand}
                    />
                )}
                {totalSuggestions > 0 && atQuery && (
                    <div className="sug-popover" role="listbox" aria-label="Reference suggestions">
                        {packMatches.map((pack, i) => (
                            <div
                                key={`pack-${pack.id}`}
                                className={`sug-item${i === selectedIdx ? " active" : ""}`}
                                role="option"
                                aria-selected={i === selectedIdx}
                                onMouseDown={(e) => { e.preventDefault(); selectPack(pack.id); }}
                            >
                                <span className="sug-icon"><Ico.Folder size={13} /></span>
                                <span className="sug-label">pack: {pack.name}</span>
                                <span className="sug-path">{pack.refs.length} refs</span>
                            </div>
                        ))}
                        {suggestions.map((ref, i) => {
                            const idx = i + packMatches.length;
                            return (
                                <div
                                    key={ref.id}
                                    className={`sug-item${idx === selectedIdx ? " active" : ""}`}
                                    role="option"
                                    aria-selected={idx === selectedIdx}
                                    onMouseDown={(e) => { e.preventDefault(); selectSuggestion(ref); }}
                                >
                                    {ref.kind !== "image" && (
                                        <>
                                            <span className="sug-icon">
                                                {ref.kind === "folder" ? <Ico.Folder size={13} /> : <Ico.File size={13} />}
                                            </span>
                                            <span className="sug-label">{ref.label ?? ref.path.split("/").pop()}</span>
                                            <span className="sug-path">{ref.path}</span>
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
                {references.length > 0 && (
                    <div className="reference-chips" aria-label="References">
                        {references.map((ref) => (
                            <span
                                className={`reference-chip ref-${ref.kind}`}
                                key={ref.id}
                                title={ref.kind === "image" ? `${ref.mimeType}, ${formatBytes(ref.size)}` : `${ref.kind}: ${ref.path}`}
                            >
                                {ref.kind === "image" ? (
                                    <img className="reference-thumb" src={`data:${ref.mimeType};base64,${ref.data}`} alt="" />
                                ) : ref.kind === "folder" ? (
                                    <Ico.Folder size={12} />
                                ) : (
                                    <Ico.File size={12} />
                                )}
                                <span>{ref.kind === "image" ? `${ref.label || "Pasted image"} (${formatBytes(ref.size)})` : ref.label || ref.path}</span>
                                <button
                                    type="button"
                                    onClick={() => onRemoveReference?.(ref.id)}
                                    title={`Remove ${ref.label || ref.id}`}
                                    aria-label={`Remove ${ref.label || ref.id}`}
                                >
                                    <Ico.Close size={10} />
                                </button>
                            </span>
                        ))}
                        {savePromptOpen ? (
                            <span className="pack-save-prompt">
                                <input
                                    className="pack-save-input"
                                    autoFocus
                                    value={packDraft}
                                    onChange={(e) => setPackDraft(e.target.value)}
                                    onBlur={commitSavePack}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") commitSavePack();
                                        else if (e.key === "Escape") { setPackDraft(""); setSavePromptOpen(false); }
                                    }}
                                    placeholder="Pack name…"
                                />
                            </span>
                        ) : (
                            <button
                                type="button"
                                className="pack-save-btn"
                                onClick={() => { setSavePromptOpen(true); setPackDraft(""); }}
                                title="Save current references as a reusable pack"
                            >
                                Save as pack
                            </button>
                        )}
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
                    onPaste={handlePaste}
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
                        {orderedPacks.length > 0 && (
                            <button
                                className="attach-btn"
                                onClick={() => setShowPacks((v) => !v)}
                                disabled={disabled}
                                title="Manage reference packs"
                                aria-label="Manage reference packs"
                            >
                                <Ico.Folder size={13} />
                            </button>
                        )}
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

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function commandQueryFor(input: string): string | undefined {
    const trimmed = input.trimStart();
    if (!trimmed.startsWith("/") || trimmed.includes(" ") || trimmed.includes("\n")) {
        return undefined;
    }
    return trimmed.slice(1);
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
