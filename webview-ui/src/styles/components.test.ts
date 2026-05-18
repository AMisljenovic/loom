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
