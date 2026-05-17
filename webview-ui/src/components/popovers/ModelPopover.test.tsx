import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LlmConfigView, LlmProvider } from "../../../../src/shared/protocol";
import { ModelPopover } from "./ModelPopover";

function config(provider: LlmProvider, baseUrl?: string, model = ""): LlmConfigView {
    return {
        provider,
        model,
        baseUrl,
        apiKeys: { anthropic: false, openai: false, "openai-compatible": false },
    };
}

function render(provider: LlmProvider, baseUrl?: string, model = ""): string {
    return renderToStaticMarkup(
        <ModelPopover
            config={config(provider, baseUrl, model)}
            onClose={() => undefined}
            onOpenSettings={() => undefined}
        />,
    );
}

describe("ModelPopover preset UI", () => {
    it("does not render a preset dropdown for Anthropic", () => {
        const html = render("anthropic");
        expect(html).not.toContain(">Preset<");
    });

    it("renders the preset dropdown for openai-compatible", () => {
        const html = render("openai-compatible", "https://ai-gateway.vercel.sh/v1");
        expect(html).toContain(">Preset<");
        expect(html).toContain("Vercel AI Gateway");
    });

    it("detects the Vercel preset from baseUrl", () => {
        const html = render("openai-compatible", "https://ai-gateway.vercel.sh/v1");
        expect(html).toMatch(/<option[^>]*value="vercel"[^>]*selected/);
    });

    it("detects the LM Studio preset from a localhost URL", () => {
        const html = render("openai-compatible", "http://localhost:1234/v1");
        expect(html).toMatch(/<option[^>]*value="lmstudio"[^>]*selected/);
    });
});
