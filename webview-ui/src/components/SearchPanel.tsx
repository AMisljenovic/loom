import { useState } from "react";
import * as Ico from "../brand/icons";
import { post } from "../vscode";

interface SearchPanelProps {
    onClose: () => void;
}

export function SearchPanel({ onClose }: SearchPanelProps) {
    const [query, setQuery] = useState("");
    const [topK, setTopK] = useState(8);

    const submit = () => {
        const q = query.trim();
        if (!q) return;
        post({ type: "semanticQuerySubmit", query: q, topK });
        onClose();
    };

    return (
        <div className="convo-list workflow-panel search-panel">
            <div className="convo-list-head">
                <span>Semantic search</span>
                <button className="convo-new" onClick={onClose}>Close</button>
            </div>
            <div className="search-panel-row">
                <input
                    className="search-panel-input"
                    autoFocus
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                    placeholder="Search this workspace by meaning…"
                />
                <label className="search-panel-topk">
                    top
                    <input
                        type="number"
                        min={1}
                        max={50}
                        value={topK}
                        onChange={(e) => setTopK(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                    />
                </label>
                <button className="btn btn-primary btn-sm" disabled={!query.trim()} onClick={submit}>
                    <Ico.Send size={11} /> Search
                </button>
            </div>
            <div className="search-panel-hint">
                Runs the <code>semantic_search</code> tool through Loom and posts results into the active chat.
                Requires <code>LOOM_EMBED_PROVIDER</code> to be configured.
            </div>
        </div>
    );
}
