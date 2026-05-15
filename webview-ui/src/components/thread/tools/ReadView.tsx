import { useMemo } from "react";

interface ReadViewProps {
    output: string | undefined;
}

export function ReadView({ output }: ReadViewProps) {
    const lines = useMemo(() => (output ?? "").split("\n"), [output]);

    return (
        <div className="read-view">
            <table className="read-table">
                <tbody>
                    {lines.map((line, i) => (
                        <tr key={i} className="read-row">
                            <td className="read-ln">{i + 1}</td>
                            <td className="read-src">
                                <code>{line}</code>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
