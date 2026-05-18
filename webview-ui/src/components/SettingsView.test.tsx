import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LlmConfigView, LlmProvider } from "../../../src/shared/protocol";
import { SettingsView } from "./SettingsView";

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
        <SettingsView config={config(provider, baseUrl, model)} onClose={() => undefined} />,
    );
}

describe("SettingsView preset UI", () => {
    it("uses a dense provider segmented control", () => {
        const html = render("openai");
        expect(html).toContain("provider-segmented");
        expect(html).toContain('role="tablist"');
        expect(html).toContain("provider-segment active");
    });

    it("hides the preset dropdown for non-compatible providers", () => {
        const html = render("anthropic");
        expect(html).not.toContain(">Preset<");
    });

    it("renders the preset dropdown for openai-compatible", () => {
        const html = render("openai-compatible", "https://openrouter.ai/api/v1");
        expect(html).toContain(">Preset<");
        expect(html).toContain("OpenRouter");
        expect(html).toContain("Generic (custom endpoint)");
    });

    it("auto-detects the Cerebras preset from baseUrl", () => {
        const html = render("openai-compatible", "https://api.cerebras.ai/v1");
        expect(html).toMatch(/<option[^>]*value="cerebras"[^>]*selected/);
    });

    it("shows the preset's key-hint link in the API Key label", () => {
        const html = render("openai-compatible", "https://api.groq.com/openai/v1");
        expect(html).toContain("https://console.groq.com/keys");
        expect(html).toContain("Get a Groq key");
    });

    it("renders only current Anthropic model ids in the dropdown", () => {
        const html = render("anthropic");
        expect(html).toContain("Claude Opus 4.7");
        expect(html).toContain("Claude Sonnet 4.6");
        expect(html).toContain("Claude Haiku 4.5");
        expect(html).not.toContain("claude-3-7-sonnet");
        expect(html).not.toContain("claude-3-5-sonnet");
    });

    it("renders only current OpenAI model ids in the dropdown", () => {
        const html = render("openai");
        expect(html).toContain("GPT-5.1");
        expect(html).toContain("o5-mini");
        expect(html).not.toContain('value="gpt-4o"');
        expect(html).not.toContain('value="gpt-4o-mini"');
    });
});
