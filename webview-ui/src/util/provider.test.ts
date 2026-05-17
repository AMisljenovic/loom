import { describe, expect, it } from "vitest";
import {
    ANTHROPIC_MODELS,
    OPENAI_COMPATIBLE_PRESETS,
    OPENAI_MODELS,
    defaultCompatiblePresetId,
    defaultModel,
    detectPreset,
    modelSuggestions,
    presetById,
    providerLabel,
    providerSubtitle,
} from "./provider";

describe("OPENAI_COMPATIBLE_PRESETS", () => {
    it("includes the documented presets", () => {
        const ids = OPENAI_COMPATIBLE_PRESETS.map((p) => p.id);
        expect(ids).toEqual(["openrouter", "groq", "cerebras", "vercel", "lmstudio", "generic"]);
    });

    it("has a single Generic preset with empty baseUrl and no models", () => {
        const generic = OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === "generic");
        expect(generic).toBeDefined();
        expect(generic?.baseUrl).toBe("");
        expect(generic?.models).toHaveLength(0);
    });

    it("every non-Generic preset has at least one curated model", () => {
        for (const p of OPENAI_COMPATIBLE_PRESETS) {
            if (p.id === "generic") continue;
            expect(p.models.length).toBeGreaterThan(0);
            expect(p.baseUrl.length).toBeGreaterThan(0);
        }
    });
});

describe("detectPreset", () => {
    it("maps known base URLs to their preset", () => {
        expect(detectPreset("https://openrouter.ai/api/v1").id).toBe("openrouter");
        expect(detectPreset("https://api.groq.com/openai/v1").id).toBe("groq");
        expect(detectPreset("https://api.cerebras.ai/v1").id).toBe("cerebras");
        expect(detectPreset("https://ai-gateway.vercel.sh/v1").id).toBe("vercel");
        expect(detectPreset("http://localhost:1234/v1").id).toBe("lmstudio");
    });

    it("ignores a trailing slash", () => {
        expect(detectPreset("https://openrouter.ai/api/v1/").id).toBe("openrouter");
    });

    it("falls back to Generic for unknown or empty URLs", () => {
        expect(detectPreset(undefined).id).toBe("generic");
        expect(detectPreset("").id).toBe("generic");
        expect(detectPreset("   ").id).toBe("generic");
        expect(detectPreset("https://example.com/v1").id).toBe("generic");
    });
});

describe("presetById", () => {
    it("returns the matching preset", () => {
        expect(presetById("groq").id).toBe("groq");
    });

    it("falls back to Generic for unknown ids", () => {
        expect(presetById("nope").id).toBe("generic");
        expect(presetById(undefined).id).toBe("generic");
    });
});

describe("modelSuggestions", () => {
    it("returns the static lists for fixed providers", () => {
        expect(modelSuggestions("anthropic")).toBe(ANTHROPIC_MODELS);
        expect(modelSuggestions("openai")).toBe(OPENAI_MODELS);
    });

    it("returns preset models for openai-compatible", () => {
        const groq = modelSuggestions("openai-compatible", "groq");
        expect(groq.length).toBeGreaterThan(0);
        expect(groq).toBe(presetById("groq").models);
    });

    it("defaults to the openrouter preset when no presetId is given", () => {
        const def = modelSuggestions("openai-compatible");
        expect(def).toBe(presetById(defaultCompatiblePresetId()).models);
    });
});

describe("defaultModel", () => {
    it("returns current model ids for each provider", () => {
        expect(defaultModel("anthropic")).toBe("claude-opus-4-7");
        expect(defaultModel("openai")).toBe("gpt-5.1");
        expect(defaultModel("local")).toBe("llama3.3");
    });

    it("returns the first model of the chosen preset for openai-compatible", () => {
        expect(defaultModel("openai-compatible", "groq")).toBe(presetById("groq").models[0]?.value);
    });

    it("returns an empty string for the generic preset", () => {
        expect(defaultModel("openai-compatible", "generic")).toBe("");
    });
});

describe("providerLabel / providerSubtitle", () => {
    it("labels the openai-compatible provider as More Providers", () => {
        expect(providerLabel("openai-compatible")).toBe("More Providers");
    });

    it("returns a non-empty subtitle for every provider", () => {
        for (const p of ["anthropic", "openai", "openai-compatible", "local"] as const) {
            expect(providerSubtitle(p).length).toBeGreaterThan(0);
        }
    });

    it("subtitle for openai-compatible hints at the preset list", () => {
        const sub = providerSubtitle("openai-compatible");
        expect(sub).toMatch(/OpenRouter|Groq/);
    });
});

describe("curated model lists are current", () => {
    it("Anthropic dropdown omits Claude 3.x entries", () => {
        const values = ANTHROPIC_MODELS.map((m) => m.value);
        expect(values).not.toContain("claude-3-7-sonnet-20250219");
        expect(values).not.toContain("claude-3-5-sonnet-20241022");
    });

    it("OpenAI dropdown omits GPT-4o entries", () => {
        const values = OPENAI_MODELS.map((m) => m.value);
        expect(values).not.toContain("gpt-4o");
        expect(values).not.toContain("gpt-4o-mini");
    });
});
