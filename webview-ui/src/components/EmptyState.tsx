import React from "react";
import type { ModeDefinition } from "../../../src/shared/protocol";
import { LoomMark } from "../brand/LoomMark";
import * as Ico from "../brand/icons";

const MODE_SUGGESTIONS: Record<string, { icon: React.ReactNode; label: string; prompt: string }[]> = {
    code: [
        { icon: <Ico.Code size={13} />, label: "Refactor a function", prompt: "/refactor " },
        { icon: <Ico.Diff size={13} />, label: "Apply a patch", prompt: "Apply the following diff: " },
        { icon: <Ico.Spark size={13} />, label: "Generate tests", prompt: "/test " },
    ],
    ask: [
        { icon: <Ico.Ask size={13} />, label: "Explain this file", prompt: "/explain " },
        { icon: <Ico.Search size={13} />, label: "Find usages of a symbol", prompt: "Find all usages of " },
        { icon: <Ico.Code size={13} />, label: "How does X work?", prompt: "Explain how " },
    ],
    debug: [
        { icon: <Ico.Bug size={13} />, label: "Debug an error", prompt: "Debug this error: " },
        { icon: <Ico.Terminal size={13} />, label: "Trace a crash", prompt: "Trace why " },
        { icon: <Ico.Warn size={13} />, label: "Fix a test failure", prompt: "Fix this failing test: " },
    ],
    architect: [
        { icon: <Ico.Compass size={13} />, label: "Design a module", prompt: "Design a module for " },
        { icon: <Ico.File size={13} />, label: "Document an API", prompt: "Document the API for " },
        { icon: <Ico.Code size={13} />, label: "Plan a refactor", prompt: "Plan a refactor of " },
    ],
};

const DEFAULT_SUGGESTIONS = MODE_SUGGESTIONS.code;

interface EmptyStateProps {
    mode: ModeDefinition | undefined;
    onSuggest: (prompt: string) => void;
}

export function EmptyState({ mode, onSuggest }: EmptyStateProps) {
    const suggestions = (mode && MODE_SUGGESTIONS[mode.id]) ?? DEFAULT_SUGGESTIONS;
    return (
        <div className="empty-state">
            <div className="empty-mark">
                <LoomMark size={40} />
            </div>
            <h2>Loom</h2>
            <p>
                {mode ? `${mode.label} mode — ready to help.` : "Start a conversation with the AI agent."}
            </p>
            <div className="suggestions">
                {suggestions.map((s, i) => (
                    <button key={i} className="suggestion" onClick={() => onSuggest(s.prompt)}>
                        <span className="suggestion-glyph">{s.icon}</span>
                        <span className="suggestion-label">{s.label}</span>
                        <span className="suggestion-arrow">→</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
