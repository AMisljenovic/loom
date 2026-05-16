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
        case "get_diagnostics":
            return pick("path") ?? pick("severity") ?? "workspace";
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
