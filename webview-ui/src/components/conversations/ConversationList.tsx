import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SessionMeta, SessionSearchHit, SessionsIndex } from "../../../../src/shared/protocol";
import * as Ico from "../../brand/icons";
import { formatAge } from "../../util/format";
import { post } from "../../vscode";

interface ConversationListProps {
    index: SessionsIndex | null;
    showArchived: boolean;
    onToggleArchived: () => void;
    renamingId: string | null;
    onBeginRename: (id: string) => void;
    onEndRename: () => void;
    onNewConversation: () => void;
    onSessionPicked: () => void;
    searchResults: SessionSearchHit[];
    onSearch: (query: string) => void;
}

export function ConversationList({
    index,
    showArchived,
    onToggleArchived,
    renamingId,
    onBeginRename,
    onEndRename,
    onNewConversation,
    onSessionPicked,
    searchResults,
    onSearch,
}: ConversationListProps) {
    const [query, setQuery] = useState("");
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const updateQuery = (value: string) => {
        setQuery(value);
        if (searchTimerRef.current !== null) clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(() => {
            searchTimerRef.current = null;
            onSearch(value);
        }, 180);
    };

    const hasIndex = !!index && Object.keys(index.sessions).length > 0;
    if (!hasIndex) {
        return (
            <div className="convo-list">
                <div className="convo-list-head">
                    <span>Sessions</span>
                    <div className="convo-head-actions">
                        <button className="convo-new" onClick={() => post({ type: "sessionImport" })} title="Import a session">
                            <Ico.Folder size={11} />
                            Import
                        </button>
                        <button className="convo-new" onClick={onNewConversation}>
                            <Ico.Plus size={11} />
                            New
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const all = index.order
        .map((id) => index.sessions[id])
        .filter((m): m is SessionMeta => !!m);

    const pinned = all.filter((m) => m.pinned && m.state === "active").sort((a, b) => b.updatedAt - a.updatedAt);
    const recent = all.filter((m) => !m.pinned && m.state === "active").sort((a, b) => b.updatedAt - a.updatedAt);
    const archived = all.filter((m) => m.state === "archived").sort((a, b) => b.updatedAt - a.updatedAt);

    const row = (meta: SessionMeta) => (
        <ConversationRow
            key={meta.conversationId}
            meta={meta}
            isActive={meta.conversationId === index.activeId}
            isRenaming={renamingId === meta.conversationId}
            onBeginRename={() => onBeginRename(meta.conversationId)}
            onEndRename={onEndRename}
            onSessionPicked={onSessionPicked}
            matchCount={hitsById.get(meta.conversationId)?.matches.length}
        />
    );

    const trimmed = query.trim();
    const hitsById = new Map(searchResults.map((h) => [h.conversationId, h]));

    return (
        <div className="convo-list">
            <div className="convo-list-head">
                <span>Sessions</span>
                <div className="convo-head-actions">
                    <button className="convo-new" onClick={() => post({ type: "sessionImport" })} title="Import a session">
                        <Ico.Folder size={11} />
                        Import
                    </button>
                    <button className="convo-new" onClick={onNewConversation}>
                        <Ico.Plus size={11} />
                        New
                    </button>
                </div>
            </div>
            <div className="convo-search">
                <input
                    type="search"
                    value={query}
                    onChange={(e) => updateQuery(e.target.value)}
                    placeholder="Search sessions and transcripts…"
                    aria-label="Search sessions"
                />
                {trimmed && searchResults.length > 0 && (
                    <span className="convo-search-count">{searchResults.length} match{searchResults.length === 1 ? "" : "es"}</span>
                )}
            </div>
            {trimmed && searchResults.length > 0 && (
                <div className="convo-search-results">
                    {searchResults.map((hit) => {
                        const meta = index!.sessions[hit.conversationId];
                        return (
                            <div className="convo-search-hit" key={hit.conversationId}>
                                <button
                                    className="convo-search-title"
                                    onClick={() => {
                                        post({ type: "switchSession", conversationId: hit.conversationId });
                                        onSessionPicked();
                                    }}
                                >
                                    {meta?.title || hit.title}
                                </button>
                                {hit.matches.map((m, i) => (
                                    <div className="convo-search-snippet" key={i}>{m.snippet}</div>
                                ))}
                            </div>
                        );
                    })}
                </div>
            )}
            {trimmed && searchResults.length === 0 && (
                <div className="convo-search-empty">No transcript matches for "{trimmed}".</div>
            )}
            {pinned.length > 0 && (
                <>
                    <div className="section-head">Pinned</div>
                    {pinned.map(row)}
                </>
            )}
            {recent.length > 0 && (
                <>
                    {pinned.length > 0 && <div className="section-head">Recent</div>}
                    {recent.map(row)}
                </>
            )}
            {archived.length > 0 && (
                <>
                    <button
                        className={`archived-toggle${showArchived ? " open" : ""}`}
                        onClick={onToggleArchived}
                    >
                        <Ico.Chev size={10} className="chev" />
                        Archived ({archived.length})
                    </button>
                    {showArchived && archived.map(row)}
                </>
            )}
        </div>
    );
}

interface ConversationRowProps {
    meta: SessionMeta;
    isActive: boolean;
    isRenaming: boolean;
    onBeginRename: () => void;
    onEndRename: () => void;
    onSessionPicked: () => void;
    matchCount?: number;
}

function ConversationRow({ meta, isActive, isRenaming, onBeginRename, onEndRename, onSessionPicked, matchCount }: ConversationRowProps) {
    const [draft, setDraft] = useState(meta.title);
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
    const menuRef = useRef<HTMLDivElement>(null);
    const moreRef = useRef<HTMLButtonElement>(null);
    const portalRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isRenaming) setDraft(meta.title);
    }, [isRenaming, meta.title]);

    useEffect(() => {
        if (!menuOpen) return;
        const onDocClick = (e: MouseEvent) => {
            if (
                !menuRef.current?.contains(e.target as Node) &&
                !portalRef.current?.contains(e.target as Node)
            ) setMenuOpen(false);
        };
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, [menuOpen]);

    const commitRename = () => {
        const next = draft.trim();
        if (next && next !== meta.title) {
            post({ type: "renameSession", conversationId: meta.conversationId, title: next });
        }
        onEndRename();
    };

    const classes = [
        "convo-item",
        isActive ? "active" : "",
        !meta.title ? "untitled" : "",
        menuOpen ? "menu-open" : "",
    ].filter(Boolean).join(" ");

    return (
        <div className={classes}>
            {meta.pinned && <Ico.Pin size={10} className="convo-pin" />}
            {!meta.pinned && <span className="convo-pin" />}

            {isRenaming ? (
                <input
                    className="convo-rename-input"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        else if (e.key === "Escape") onEndRename();
                    }}
                />
            ) : (
                <button
                    className="convo-title"
                    style={{ background: "transparent", border: 0, font: "inherit", textAlign: "left", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "inherit", padding: 0, minWidth: 0 }}
                    onClick={() => {
                        post({ type: "switchSession", conversationId: meta.conversationId });
                        onSessionPicked();
                    }}
                    onDoubleClick={onBeginRename}
                    title={meta.title || "(untitled)"}
                >
                    {meta.title || <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>(untitled)</span>}
                </button>
            )}

            {typeof matchCount === "number" && matchCount > 0 && (
                <span className="convo-match-count" title={`${matchCount} match${matchCount === 1 ? "" : "es"}`}>{matchCount}</span>
            )}
            <span className="convo-age">{formatAge(meta.updatedAt)}</span>

            <div ref={menuRef} style={{ flexShrink: 0 }}>
                <button
                    ref={moreRef}
                    className="convo-more"
                    aria-label="Session menu"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (!menuOpen && moreRef.current) {
                            const r = moreRef.current.getBoundingClientRect();
                            setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
                        }
                        setMenuOpen((v) => !v);
                    }}
                >
                    <Ico.More size={12} />
                </button>
                {menuOpen && createPortal(
                    <div
                        ref={portalRef}
                        className="context-menu"
                        style={{ position: "fixed", top: menuPos.top, right: menuPos.right }}
                    >
                        <button className="ctx-item" onClick={() => { setMenuOpen(false); onBeginRename(); }}>
                            <Ico.Edit size={12} /> Rename
                        </button>
                        <button className="ctx-item" onClick={() => { setMenuOpen(false); post({ type: "togglePinSession", conversationId: meta.conversationId }); }}>
                            <Ico.Pin size={12} /> {meta.pinned ? "Unpin" : "Pin"}
                        </button>
                        <button className="ctx-item" onClick={() => { setMenuOpen(false); post({ type: "sessionExport", conversationId: meta.conversationId, format: "markdown" }); }}>
                            <Ico.File size={12} /> Export as Markdown
                        </button>
                        <button className="ctx-item" onClick={() => { setMenuOpen(false); post({ type: "sessionExport", conversationId: meta.conversationId, format: "json" }); }}>
                            <Ico.File size={12} /> Export as JSON
                        </button>
                        <div className="ctx-sep" />
                        {meta.state === "archived" ? (
                            <button className="ctx-item" onClick={() => { setMenuOpen(false); post({ type: "unarchiveSession", conversationId: meta.conversationId }); }}>
                                Unarchive
                            </button>
                        ) : (
                            <button className="ctx-item" onClick={() => { setMenuOpen(false); post({ type: "archiveSession", conversationId: meta.conversationId }); }}>
                                Archive
                            </button>
                        )}
                        <div className="ctx-sep" />
                        <button className="ctx-item danger" onClick={() => { setMenuOpen(false); post({ type: "deleteSession", conversationId: meta.conversationId }); }}>
                            <Ico.Trash size={12} /> Delete
                        </button>
                    </div>,
                    document.body
                )}
            </div>
        </div>
    );
}
