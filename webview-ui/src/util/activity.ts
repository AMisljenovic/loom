import type { Msg, QuestionAnswer, QuestionSpec } from "../../../src/shared/protocol";

export function toolActivityLabel(msg: Extract<Msg, { role: "tool" }>): string {
    const target = summarizeToolInput(msg.name, msg.input);
    const suffix = target ? ` ${target}` : "";
    switch (msg.name) {
        case "read_file": return `Read${suffix}`;
        case "list_dir": return `Listed${suffix}`;
        case "search": return `Searched${suffix}`;
        case "find_symbol": return `Found symbol${suffix}`;
        case "find_references": return `Found references${suffix}`;
        case "semantic_search": return `Searched semantically${suffix}`;
        case "get_diagnostics": return `Checked diagnostics${suffix}`;
        case "update_todos": return `Updated todos${suffix}`;
        case "load_skill": return `Loaded skill${suffix}`;
        case "apply_diff": return msg.status === "pending" ? `Approve changes${suffix}` : `Changed${suffix}`;
        case "run_command": return msg.status === "pending" ? `Approve command${suffix}` : `Ran${suffix}`;
        case "run_command_background": return msg.status === "pending" ? `Approve process${suffix}` : `Started process${suffix}`;
        case "read_process_output": return `Read process output${suffix}`;
        case "kill_process": return msg.status === "pending" ? `Approve stopping process${suffix}` : `Stopped process${suffix}`;
        case "spawn_subagent": return `Started research${suffix}`;
        default: return `Used ${msg.name}${suffix}`;
    }
}

export function summarizeToolInput(name: string, input: unknown): string | undefined {
    if (!input || typeof input !== "object") return undefined;
    const i = input as Record<string, unknown>;
    const pick = (key: string): string | undefined => {
        const v = i[key];
        return typeof v === "string" && v.trim() ? compact(v) : undefined;
    };
    switch (name) {
        case "read_file":
        case "list_dir":
        case "apply_diff":
            return pick("path");
        case "search":
        case "find_symbol":
        case "find_references":
        case "semantic_search":
            return pick("query");
        case "run_command":
        case "run_command_background":
            return pick("command");
        case "kill_process":
        case "read_process_output":
            return pick("processId");
        case "load_skill": {
            const ids = i.ids;
            if (Array.isArray(ids)) return compact(ids.filter((id) => typeof id === "string").join(", "));
            return undefined;
        }
        case "get_diagnostics": {
            const path = pick("path");
            if (path) return path;
            const severity = pick("severity");
            if (severity) return `severity=${severity}`;
            return "workspace";
        }
        case "update_todos":
            return pick("title");
        case "spawn_subagent":
            return pick("task") ?? pick("type");
        default:
            return pick("path") ?? pick("query") ?? pick("command");
    }
}

export function questionActivityLabel(msg: Extract<Msg, { role: "question" }>): string {
    const title = compact(msg.title || "Questions");
    if (msg.status === "answered") return `Answered ${title}`;
    if (msg.status === "cancelled") return `Expired ${title}`;
    return title;
}

export function selectedAnswerLabels(question: QuestionSpec, answers: QuestionAnswer[] | undefined): string[] {
    const answer = answers?.find((a) => a.questionId === question.id);
    const labels = new Map(question.options.map((o) => [o.id, o.label]));
    const selected = answer?.selectedOptionIds
        .map((id) => labels.get(id))
        .filter((label): label is string => Boolean(label)) ?? [];
    if (answer?.otherText) selected.push(answer.otherText);
    return selected;
}

function compact(text: string): string {
    const cleaned = text.trim().replace(/\s+/g, " ");
    return cleaned.length > 90 ? `${cleaned.slice(0, 87)}...` : cleaned;
}

// Short bold label shown as the tool card's title — Claude-Code-style.
// Groups verbose internal names into one familiar word users can scan.
export function toolLabel(name: string, input?: unknown): string {
    switch (name) {
        case "run_command":
        case "run_command_background":
            return commandShellLabel(input);
        case "read_process_output":
        case "kill_process":
            return "Process";
        case "apply_diff":
            return "Edit";
        case "read_file":
            return "Read";
        case "list_dir":
            return "List";
        case "search":
        case "grep":
            return "Search";
        case "find_symbol":
        case "find_references":
            return "Symbol";
        case "semantic_search":
            return "Semantic";
        case "get_diagnostics":
            return "Diagnostics";
        case "update_todos":
            return "Todos";
        case "spawn_subagent":
            return "Research";
        case "load_skill":
            return "Skill";
        default:
            return titleCase(name);
    }
}

function commandShellLabel(input: unknown): string {
    if (!input || typeof input !== "object") return "Shell";
    const shell = (input as Record<string, unknown>).shell;
    switch (shell) {
        case "powershell":
            return "PowerShell";
        case "cmd":
            return "Command";
        case "bash":
            return "Bash";
        case "sh":
            return "Sh";
        default:
            return "Shell";
    }
}

// Single-line content for the IN pane. Falls back to the input summary,
// then to the tool name. Always one short line.
export function toolInputLine(name: string, input: unknown): string {
    const summary = summarizeToolInput(name, input);
    if (summary) return summary;
    return name;
}

// True when a get_diagnostics tool call returned the canonical empty marker.
// Used by ToolCardMinimal to suppress the expandable body and duration badge
// so a "no diagnostics" check renders as a single quiet line instead of an
// empty error-looking card.
export function isEmptyDiagnosticsCall(name: string, output: string | undefined): boolean {
    if (name !== "get_diagnostics" || !output) return false;
    return output.trim() === "no diagnostics";
}

// First N lines of output for the OUT peek. Returns trimmed lines; the
// caller decides how to render the ellipsis state.
export function peekLines(output: string | undefined, max = 3): { lines: string[]; more: boolean } {
    if (!output) return { lines: [], more: false };
    const all = output.replace(/\r\n/g, "\n").split("\n");
    const trimmed = all.length > 0 && all[all.length - 1] === "" ? all.slice(0, -1) : all;
    const lines = trimmed.slice(0, max);
    return { lines, more: trimmed.length > max };
}

function titleCase(name: string): string {
    return name
        .split(/[_\-\s]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
