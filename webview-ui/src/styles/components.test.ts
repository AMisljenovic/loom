import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "components.css"), "utf8");

function rule(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
    if (!match) throw new Error(`Missing CSS rule for ${selector}`);
    return match[1];
}

function expectDeclaration(block: string, name: string, value: string): void {
    expect(block.replace(/\s+/g, " ")).toContain(`${name}: ${value}`);
}

describe("component layout CSS invariants", () => {
    it("keeps the transcript as the only shrinking scroll row", () => {
        const panel = rule(".panel");
        expectDeclaration(panel, "grid-template-rows", "auto auto auto minmax(0, 1fr) auto auto auto");

        const thread = rule(".thread");
        expectDeclaration(thread, "grid-row", "4");
        expectDeclaration(thread, "overflow-y", "auto");
        expectDeclaration(thread, "min-height", "0");
        expectDeclaration(thread, "display", "flex");
        expectDeclaration(thread, "flex-direction", "column");

        const sentinel = rule(".thread-bottom-sentinel");
        expectDeclaration(sentinel, "flex-shrink", "0");
        expectDeclaration(sentinel, "height", "1px");
    });

    it("prevents expanded tool cards from being flex-shrunk and clipped", () => {
        const card = rule(".tc-mini");
        expectDeclaration(card, "display", "flex");
        expectDeclaration(card, "flex-direction", "column");
        expectDeclaration(card, "flex-shrink", "0");
        expectDeclaration(card, "overflow", "hidden");

        const expanded = rule(".tc-expand");
        expectDeclaration(expanded, "display", "flex");
        expectDeclaration(expanded, "flex-direction", "column");
    });

    it("keeps composer and toolbar outside the transcript scroll row", () => {
        expectDeclaration(rule(".input-area"), "grid-row", "6");
        expectDeclaration(rule(".toolbar-shell"), "grid-row", "7");
    });

    it("keeps settings provider selection compact in narrow sidebars", () => {
        const segmented = rule(".provider-segmented");
        expectDeclaration(segmented, "grid-template-columns", "repeat(4, minmax(0, 1fr))");

        const segment = rule(".provider-segment");
        expectDeclaration(segment, "white-space", "nowrap");
        expectDeclaration(segment, "overflow", "hidden");
        expectDeclaration(segment, "text-overflow", "ellipsis");
    });

    it("renders todo cards as non-shrinking transcript entries", () => {
        const card = rule(".todo-card");
        expectDeclaration(card, "flex-shrink", "0");
        expectDeclaration(card, "background", "transparent");
    });

    it("renders stop cards as non-shrinking transcript entries", () => {
        const card = rule(".stop-card");
        expectDeclaration(card, "flex-shrink", "0");
        expectDeclaration(card, "border-left", "3px solid var(--warn)");
    });

    it("renders reasoning lines as a quiet card, not borderless italic", () => {
        const intent = rule(".intent-line");
        expectDeclaration(intent, "font-style", "normal");
        expectDeclaration(intent, "background", "var(--surface-2)");
        expectDeclaration(intent, "border-radius", "var(--r-3)");
        expectDeclaration(intent, "color", "var(--text)");

        const tag = rule(".intent-tag");
        expectDeclaration(tag, "text-transform", "uppercase");
        expectDeclaration(tag, "color", "var(--text-muted)");
    });

    it("constrains card width so long code blocks scroll inside the card", () => {
        const intent = rule(".intent-line");
        expectDeclaration(intent, "min-width", "0");
        expectDeclaration(intent, "max-width", "100%");

        const summary = rule(".summary-card");
        expectDeclaration(summary, "min-width", "0");
        expectDeclaration(summary, "max-width", "100%");
        // Load-bearing: without flex-shrink:0 the card collapses behind the
        // composer in the flex column transcript and the body disappears.
        expectDeclaration(summary, "flex-shrink", "0");

        const summaryBody = rule(".summary-body");
        expectDeclaration(summaryBody, "min-width", "0");
        expectDeclaration(summaryBody, "max-width", "100%");

        const pane = rule(".tc-pane");
        expectDeclaration(pane, "min-width", "0");

        const expand = rule(".tc-expand");
        expectDeclaration(expand, "min-width", "0");

        const paneBody = rule(".tc-pane-body");
        expectDeclaration(paneBody, "min-width", "0");
        expectDeclaration(paneBody, "max-width", "100%");

        const pre = rule(".markdown-body pre");
        expectDeclaration(pre, "min-width", "0");
        expectDeclaration(pre, "max-width", "100%");
    });

    it("renders diagnostics as a non-shrinking transcript card", () => {
        const card = rule(".diagnostics-card");
        expectDeclaration(card, "flex-shrink", "0");
        expectDeclaration(card, "border-left-width", "3px");

        const loc = rule(".diagnostics-loc");
        expectDeclaration(loc, "overflow-wrap", "anywhere");
    });

    it("pins plan-handoff head and foot while scrolling the step list", () => {
        const structured = rule(".plan-handoff-structured");
        expectDeclaration(structured, "max-height", "min(50vh, 480px)");
        expectDeclaration(structured, "min-height", "0");
        expectDeclaration(structured, "overflow", "hidden");

        const head = rule(".plan-handoff-head");
        expectDeclaration(head, "flex-shrink", "0");

        const list = rule(".plan-step-list");
        expectDeclaration(list, "flex", "1 1 auto");
        expectDeclaration(list, "min-height", "0");
        expectDeclaration(list, "overflow-y", "auto");

        const foot = rule(".plan-handoff-foot");
        expectDeclaration(foot, "flex-shrink", "0");
    });

    it("makes sub-agent cards visually distinct from tool cards", () => {
        const card = rule(".subagent-card");
        expectDeclaration(card, "flex-shrink", "0");
        expectDeclaration(card, "border-left", "3px solid var(--accent)");
        expect(card.replace(/\s+/g, " ")).toContain("animation: subagent-enter");

        const tag = rule(".subagent-tag");
        expectDeclaration(tag, "color", "var(--accent)");
        expectDeclaration(tag, "text-transform", "uppercase");
    });
});
