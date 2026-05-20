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
const EXIT_FOOTER = /\r?\n?\[exit -?\d+\]\s*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function appendFooter(output: string, footer: string): string {
    if (output.length === 0) return footer;
    return /[\r\n]$/.test(output) ? `${output}${footer}` : `${output}\n${footer}`;
}

export function formatToolDisplayOutput(toolName: string, raw: string): string {
    if (raw.trim().length === 0) return "";

    if (toolName !== "run_command_background" && toolName !== "read_process_output") {
        return raw;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return raw;
    }

    if (!isRecord(parsed)) return raw;

    if (toolName === "run_command_background") {
        if (typeof parsed.processId !== "string" || typeof parsed.command !== "string") {
            return raw;
        }
        return typeof parsed.pid === "number"
            ? `Started pid ${parsed.pid} — ${parsed.command}`
            : `Started — ${parsed.command}`;
    }

    if (typeof parsed.output !== "string") return raw;

    const output = parsed.output;
    if (parsed.running === true) {
        return typeof parsed.totalBytes === "number" && output.length > 0
            ? appendFooter(output, `[…running, ${parsed.totalBytes} bytes streamed]`)
            : output;
    }

    if (parsed.running === false && typeof parsed.exitCode === "number" && !EXIT_FOOTER.test(output)) {
        return appendFooter(output, `[exit ${parsed.exitCode}]`);
    }

    return output;
}

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
