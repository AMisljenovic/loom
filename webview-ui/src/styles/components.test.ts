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
});
