import { useMemo } from "react";
import { parseUnifiedDiff } from "../../../util/parseToolOutput";

interface DiffViewProps {
    unified: string;
    relPath?: string;
}

export function DiffView({ unified, relPath }: DiffViewProps) {
    const rows = useMemo(() => parseUnifiedDiff(unified), [unified]);

    return (
        <div className="diff-view">
            {relPath && <div className="diff-path">{relPath}</div>}
            <table className="diff-table">
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={i} className={`diff-row diff-${row.type}`}>
                            <td className="diff-marker">{row.marker}</td>
                            <td className="diff-line">{row.lineNum ?? ""}</td>
                            <td className="diff-src">
                                <code>{row.src}</code>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
