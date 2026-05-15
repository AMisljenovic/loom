export interface RipgrepMatch {
    file: string;
    line: number;
    text: string;
}

export interface RipgrepResult {
    file: string;
    matches: RipgrepMatch[];
}

const RIPGREP_LINE = /^([^:]+):(\d+):(.*)$/;

export function parseRipgrep(output: string): RipgrepResult[] | null {
    const lines = output.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return null;

    let matchCount = 0;
    const byFile = new Map<string, RipgrepMatch[]>();

    for (const line of lines) {
        const m = RIPGREP_LINE.exec(line);
        if (!m) continue;
        matchCount++;
        const file = m[1];
        const lineNum = parseInt(m[2], 10);
        const text = m[3];
        const list = byFile.get(file) ?? [];
        list.push({ file, line: lineNum, text });
        byFile.set(file, list);
    }

    // Require >=50% of non-empty lines to match ripgrep format
    if (matchCount / lines.length < 0.5) return null;

    return Array.from(byFile.entries()).map(([file, matches]) => ({ file, matches }));
}

export interface DiffRow {
    type: "add" | "del" | "hunk" | "ctx";
    lineNum?: number;
    marker: string;
    src: string;
}

export function parseUnifiedDiff(unified: string): DiffRow[] {
    const rows: DiffRow[] = [];
    let lineNum = 0;
    for (const line of unified.split("\n")) {
        if (line.startsWith("@@")) {
            const m = /\+(\d+)/.exec(line);
            lineNum = m ? parseInt(m[1], 10) - 1 : lineNum;
            rows.push({ type: "hunk", marker: "@@", src: line });
        } else if (line.startsWith("+") && !line.startsWith("+++")) {
            lineNum++;
            rows.push({ type: "add", lineNum, marker: "+", src: line.slice(1) });
        } else if (line.startsWith("-") && !line.startsWith("---")) {
            rows.push({ type: "del", marker: "-", src: line.slice(1) });
        } else if (!line.startsWith("---") && !line.startsWith("+++")) {
            lineNum++;
            rows.push({ type: "ctx", lineNum, marker: " ", src: line.slice(1) });
        }
    }
    return rows;
}
