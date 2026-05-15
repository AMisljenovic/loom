import type { AlwaysAllowRule } from "../../../src/shared/protocol";

export function makeId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function makeToolRule(tool: string): AlwaysAllowRule {
    return { id: makeId(), tool, scope: "tool", createdAt: Date.now() };
}

export function makeCommandRule(command: string): AlwaysAllowRule {
    return {
        id: makeId(),
        tool: "run_command",
        scope: "argPattern",
        argKey: "command",
        pattern: `^${escapeRegex(command)}$`,
        createdAt: Date.now(),
    };
}

export function makePathRule(tool: string, relPath: string): AlwaysAllowRule {
    return {
        id: makeId(),
        tool,
        scope: "argPattern",
        argKey: "path",
        pattern: relPath,
        createdAt: Date.now(),
    };
}

export function formatRule(rule: AlwaysAllowRule): string {
    if (rule.scope === "tool") return "Any invocation";
    if (rule.argKey === "command") return `Command matches ${rule.pattern ?? ""}`;
    return `Path matches ${rule.pattern ?? ""}`;
}

export function inputString(input: unknown, key: "command" | "path"): string | undefined {
    if (typeof input !== "object" || input === null || !(key in input)) return undefined;
    const value = (input as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
}

export function isPathTool(tool: string): boolean {
    return tool === "apply_diff" || tool === "read_file" || tool === "list_dir" || tool === "search";
}

export function shortLabel(value: string): string {
    return value.length > 32 ? `${value.slice(0, 29)}...` : value;
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
