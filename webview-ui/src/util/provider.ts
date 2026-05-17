import type { LlmProvider } from "../../../src/shared/protocol";

export interface ModelSuggestion {
    label: string;
    value: string;
}

export const ANTHROPIC_MODELS: ModelSuggestion[] = [
    { label: "Claude Opus 4.7", value: "claude-opus-4-7" },
    { label: "Claude 3.7 Sonnet", value: "claude-3-7-sonnet-20250219" },
    { label: "Claude 3.5 Sonnet", value: "claude-3-5-sonnet-20241022" },
];

export const OPENAI_MODELS: ModelSuggestion[] = [
    { label: "GPT-5", value: "gpt-5" },
    { label: "GPT-4o", value: "gpt-4o" },
    { label: "GPT-4o Mini", value: "gpt-4o-mini" },
];

export const OPENAI_COMPATIBLE_MODELS: ModelSuggestion[] = [
    { label: "GPT-4o", value: "gpt-4o" },
    { label: "GPT-4o Mini", value: "gpt-4o-mini" },
    { label: "Llama 3.1 70B", value: "llama-3.1-70b" },
    { label: "Qwen 2.5 Coder 32B", value: "qwen-2.5-coder-32b" },
];

export const LOCAL_MODELS: ModelSuggestion[] = [
    { label: "Llama 3.1", value: "llama3.1" },
    { label: "Qwen 2.5 Coder", value: "qwen2.5-coder" },
    { label: "Mistral", value: "mistral" },
];

export function modelSuggestions(provider: LlmProvider): ModelSuggestion[] {
    switch (provider) {
        case "anthropic": return ANTHROPIC_MODELS;
        case "openai": return OPENAI_MODELS;
        case "openai-compatible": return OPENAI_COMPATIBLE_MODELS;
        case "local": return LOCAL_MODELS;
    }
}

export function defaultModel(provider: LlmProvider): string {
    switch (provider) {
        case "openai": return "gpt-5";
        case "openai-compatible": return "gpt-4o";
        case "local": return "llama3.1";
        case "anthropic": return "claude-opus-4-7";
    }
}

export function providerLabel(provider: LlmProvider): string {
    switch (provider) {
        case "anthropic": return "Anthropic";
        case "openai": return "OpenAI";
        case "openai-compatible": return "OpenAI-Compatible";
        case "local": return "Local";
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
