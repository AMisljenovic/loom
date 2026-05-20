import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FirstRunState, LlmProvider } from "../../../src/shared/protocol";
import { FirstRun } from "./FirstRun";

function state(provider: LlmProvider, baseUrl?: string, model = ""): FirstRunState {
    return {
        completed: false,
        needsSetup: true,
        llmConfig: {
            provider,
            model,
            baseUrl,
            apiKeys: { anthropic: false, openai: false, "openai-compatible": false },
        },
    };
}

function render(provider: LlmProvider, baseUrl?: string, model = ""): string {
    return renderToStaticMarkup(
        <FirstRun state={state(provider, baseUrl, model)} onSample={() => undefined} />,
    );
}

describe("FirstRun preset UI", () => {
    it("does not render the preset dropdown for non-compatible providers", () => {
        const html = render("anthropic");
        expect(html).not.toContain(">Preset<");
        expect(html).not.toContain('value="openrouter"');
        expect(html).not.toContain('value="groq"');
    });

    it("renders the preset dropdown when provider is openai-compatible", () => {
        const html = render("openai-compatible", "https://openrouter.ai/api/v1");
        expect(html).toContain(">Preset<");
        // All preset labels rendered as options
        expect(html).toContain("OpenRouter");
        expect(html).toContain("Groq");
        expect(html).toContain("Cerebras");
        expect(html).toContain("Google AI Studio (Gemini)");
        expect(html).toContain("Vercel AI Gateway");
        expect(html).toContain("LM Studio");
        expect(html).toContain("Generic (custom endpoint)");
    });

    it("auto-selects the preset matching the saved baseUrl", () => {
        const html = render("openai-compatible", "https://api.groq.com/openai/v1");
        // The currently-selected option carries `selected=""` in static markup
        expect(html).toMatch(/<option[^>]*value="groq"[^>]*selected/);
        expect(html).not.toMatch(/<option[^>]*value="openrouter"[^>]*selected/);
    });

    it("falls back to the Generic preset for an unknown baseUrl", () => {
        const html = render("openai-compatible", "https://example.com/v1");
        expect(html).toMatch(/<option[^>]*value="generic"[^>]*selected/);
    });

    it("shows a prominent preset console button when the active preset has one", () => {
        const html = render("openai-compatible", "https://openrouter.ai/api/v1");
        expect(html).toContain("https://openrouter.ai/keys");
        expect(html).toContain("Get an OpenRouter key →");
        expect(html).toContain("provider-console-link");
        expect(html).toContain("Sign in there, create a key, then paste it below.");
    });

    it("omits the console button for the Generic preset", () => {
        const html = render("openai-compatible", "");
        expect(html).not.toContain("provider-console-link");
        expect(html).not.toContain("Get an OpenRouter key →");
        expect(html).not.toContain("Get a Groq key →");
    });

    it("shows the native Anthropic console button", () => {
        const html = render("anthropic");
        expect(html).toContain("https://console.anthropic.com/settings/keys");
        expect(html).toContain("Open Anthropic Console →");
        expect(html).toContain("Sign in there, create a key, then paste it below.");
    });
});
