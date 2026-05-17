import type { LlmProvider } from "../../../src/shared/protocol";

export interface ModelSuggestion {
    label: string;
    value: string;
}

export const ANTHROPIC_MODELS: ModelSuggestion[] = [
    { label: "Claude Opus 4.7", value: "claude-opus-4-7" },
    { label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" },
    { label: "Claude Haiku 4.5", value: "claude-haiku-4-5" },
];

export const OPENAI_MODELS: ModelSuggestion[] = [
    { label: "GPT-5.1", value: "gpt-5.1" },
    { label: "GPT-5.1 Mini", value: "gpt-5.1-mini" },
    { label: "o5", value: "o5" },
    { label: "o5-mini", value: "o5-mini" },
];

export const LOCAL_MODELS: ModelSuggestion[] = [
    { label: "Llama 3.3", value: "llama3.3" },
    { label: "Qwen 2.5 Coder", value: "qwen2.5-coder" },
    { label: "Mistral", value: "mistral" },
];

export interface OpenAICompatiblePreset {
    id: string;
    label: string;
    baseUrl: string;
    models: ModelSuggestion[];
    keyHintUrl?: string;
    keyHintLabel?: string;
}

export const OPENAI_COMPATIBLE_PRESETS: OpenAICompatiblePreset[] = [
    {
        id: "openrouter",
        label: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        keyHintUrl: "https://openrouter.ai/keys",
        keyHintLabel: "Get an OpenRouter key",
        models: [
            { label: "Claude Opus 4.7", value: "anthropic/claude-opus-4-7" },
            { label: "Claude Sonnet 4.6", value: "anthropic/claude-sonnet-4-6" },
            { label: "GPT-5.1", value: "openai/gpt-5.1" },
            { label: "o5-mini", value: "openai/o5-mini" },
            { label: "Gemini 3 Pro", value: "google/gemini-3-pro-preview" },
            { label: "Llama 4 Maverick", value: "meta-llama/llama-4-maverick" },
        ],
    },
    {
        id: "groq",
        label: "Groq",
        baseUrl: "https://api.groq.com/openai/v1",
        keyHintUrl: "https://console.groq.com/keys",
        keyHintLabel: "Get a Groq key",
        models: [
            { label: "Llama 3.3 70B", value: "llama-3.3-70b-versatile" },
            { label: "Llama 4 Scout 17B", value: "llama-4-scout-17b" },
            { label: "Qwen3 32B", value: "qwen3-32b" },
            { label: "DeepSeek R1 Distill 70B", value: "deepseek-r1-distill-llama-70b" },
            { label: "Kimi K2", value: "kimi-k2-instruct" },
            { label: "gpt-oss 120B", value: "openai/gpt-oss-120b" },
        ],
    },
    {
        id: "cerebras",
        label: "Cerebras",
        baseUrl: "https://api.cerebras.ai/v1",
        keyHintUrl: "https://cloud.cerebras.ai",
        keyHintLabel: "Get a Cerebras key",
        models: [
            { label: "Llama 3.3 70B", value: "llama-3.3-70b" },
            { label: "Qwen3 32B", value: "qwen-3-32b" },
            { label: "gpt-oss 120B", value: "gpt-oss-120b" },
        ],
    },
    {
        id: "vercel",
        label: "Vercel AI Gateway",
        baseUrl: "https://ai-gateway.vercel.sh/v1",
        keyHintUrl: "https://vercel.com/dashboard/ai-gateway",
        keyHintLabel: "Open Vercel AI Gateway",
        models: [
            { label: "Claude Opus 4.7", value: "anthropic/claude-opus-4-7" },
            { label: "GPT-5.1", value: "openai/gpt-5.1" },
            { label: "Gemini 3 Pro", value: "google/gemini-3-pro-preview" },
        ],
    },
    {
        id: "lmstudio",
        label: "LM Studio",
        baseUrl: "http://localhost:1234/v1",
        models: [
            { label: "Qwen 2.5 Coder", value: "qwen2.5-coder" },
            { label: "Llama 3.3 70B", value: "llama-3.3-70b" },
            { label: "Mistral", value: "mistral" },
        ],
    },
    {
        id: "generic",
        label: "Generic (custom endpoint)",
        baseUrl: "",
        models: [],
    },
];

const GENERIC_PRESET = OPENAI_COMPATIBLE_PRESETS[OPENAI_COMPATIBLE_PRESETS.length - 1];
const DEFAULT_COMPATIBLE_PRESET_ID = "openrouter";

export function presetById(id: string | undefined): OpenAICompatiblePreset {
    if (!id) return GENERIC_PRESET;
    return OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === id) ?? GENERIC_PRESET;
}

export function detectPreset(baseUrl: string | undefined): OpenAICompatiblePreset {
    const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "");
    if (!trimmed) return GENERIC_PRESET;
    for (const preset of OPENAI_COMPATIBLE_PRESETS) {
        if (!preset.baseUrl) continue;
        if (preset.baseUrl.replace(/\/+$/, "") === trimmed) return preset;
    }
    return GENERIC_PRESET;
}

export function defaultCompatiblePresetId(): string {
    return DEFAULT_COMPATIBLE_PRESET_ID;
}

export function modelSuggestions(provider: LlmProvider, presetId?: string): ModelSuggestion[] {
    switch (provider) {
        case "anthropic": return ANTHROPIC_MODELS;
        case "openai": return OPENAI_MODELS;
        case "openai-compatible": return presetById(presetId ?? DEFAULT_COMPATIBLE_PRESET_ID).models;
        case "local": return LOCAL_MODELS;
    }
}

export function defaultModel(provider: LlmProvider, presetId?: string): string {
    switch (provider) {
        case "openai": return "gpt-5.1";
        case "openai-compatible": {
            const preset = presetById(presetId ?? DEFAULT_COMPATIBLE_PRESET_ID);
            return preset.models[0]?.value ?? "";
        }
        case "local": return "llama3.3";
        case "anthropic": return "claude-opus-4-7";
    }
}

export function providerLabel(provider: LlmProvider): string {
    switch (provider) {
        case "anthropic": return "Anthropic";
        case "openai": return "OpenAI";
        case "openai-compatible": return "More Providers";
        case "local": return "Local";
    }
}

export function providerSubtitle(provider: LlmProvider): string {
    switch (provider) {
        case "anthropic": return "Claude Opus, Sonnet, Haiku";
        case "openai": return "GPT-5.1, o5 series";
        case "openai-compatible": return "OpenRouter, Groq, Cerebras, Azure, vLLM…";
        case "local": return "Ollama on this machine";
    }
}

export function providerNeedsKey(provider: LlmProvider): provider is "anthropic" | "openai" | "openai-compatible" {
    return provider !== "local";
}

export function providerNeedsBaseUrl(provider: LlmProvider): boolean {
    return provider === "openai" || provider === "openai-compatible" || provider === "local";
}

export function providerSupportsReasoning(provider: LlmProvider): boolean {
    return provider === "openai" || provider === "openai-compatible";
}
