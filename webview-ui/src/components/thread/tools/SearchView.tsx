import { useMemo } from "react";
import * as Ico from "../../../brand/icons";
import { parseRipgrep } from "../../../util/parseToolOutput";

interface SearchViewProps {
    output: string | undefined;
}

export function SearchView({ output }: SearchViewProps) {
    const results = useMemo(() => parseRipgrep(output ?? ""), [output]);

    if (!results || results.length === 0) {
        return (
            <div className="search-empty">
                <Ico.Search size={14} />
                <span>No results</span>
            </div>
        );
    }

    return (
        <div className="matches">
            {results.map((r, i) => (
                <div key={i} className="match-file">
                    <div className="match-path">
                        <Ico.File size={12} />
                        <span>{r.file}</span>
                    </div>
                    {r.matches.map((m, j) => (
                        <div key={j} className="match-row">
                            <span className="match-ln">{m.line}</span>
                            <code className="match-src">{m.text}</code>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}
