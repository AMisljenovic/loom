import { useEffect, useState } from "react";
import type { FirstRunState, LlmProvider } from "../../../src/shared/protocol";
import { LoomMark } from "../brand/LoomMark";
import * as Ico from "../brand/icons";
import { post } from "../vscode";

interface FirstRunProps {
    state: FirstRunState;
    onSample: (prompt: string) => void;
}

const SAMPLE_PROMPT = "What does this project do? Read the README and summarize the main architecture.";

const MODELS: Record<Exclude<LlmProvider, "local">, { label: string; value: string }[]> = {
    anthropic: [
        { label: "Claude Opus 4.7", value: "claude-opus-4-7" },
        { label: "Claude 3.7 Sonnet", value: "claude-3-7-sonnet-20250219" },
        { label: "Claude 3.5 Sonnet", value: "claude-3-5-sonnet-20241022" },
    ],
    openai: [
        { label: "GPT-5", value: "gpt-5" },
        { label: "GPT-4o", value: "gpt-4o" },
        { label: "GPT-4o Mini", value: "gpt-4o-mini" },
    ],
};

export function FirstRun({ state, onSample }: FirstRunProps) {
    const [provider, setProvider] = useState<LlmProvider>(state.llmConfig.provider);
    const [model, setModel] = useState(state.llmConfig.model);
    const [baseUrl, setBaseUrl] = useState(state.llmConfig.baseUrl ?? "http://localhost:11434/v1");
    const [apiKey, setApiKey] = useState("");

    useEffect(() => {
        setProvider(state.llmConfig.provider);
        setModel(state.llmConfig.model);
        setBaseUrl(state.llmConfig.baseUrl ?? "http://localhost:11434/v1");
    }, [state.llmConfig.provider, state.llmConfig.model, state.llmConfig.baseUrl]);

    const providerModels = provider === "local" ? [] : MODELS[provider];
    const hasKey = provider === "local" || Boolean(state.llmConfig.apiKeys?.[provider as Exclude<LlmProvider, "local">]);
    const canContinue = provider === "local" || hasKey || apiKey.trim().length > 0;

    const apply = () => {
        if (provider !== "local" && apiKey.trim()) {
            post({ type: "setSecret", provider, apiKey: apiKey.trim() });
        }
        post({
            type: "setLlmConfig",
            config: {
                provider,
                model: model || defaultModel(provider),
                baseUrl: provider === "local" || provider === "openai" ? baseUrl || undefined : undefined,
            },
        });
        post({ type: "completeFirstRun" });
    };

    return (
        <div className="first-run">
            <div className="first-run-mark">
                <LoomMark size={42} />
            </div>
            <div className="first-run-copy">
                <h2>Set up Loom</h2>
                <p>Choose a model provider, save a key if needed, then start with a small codebase question.</p>
            </div>

            <div className="provider-grid" aria-label="Provider">
                <ProviderButton active={provider === "anthropic"} label="Anthropic" onClick={() => { setProvider("anthropic"); setModel(defaultModel("anthropic")); }} />
                <ProviderButton active={provider === "openai"} label="OpenAI" onClick={() => { setProvider("openai"); setModel(defaultModel("openai")); }} />
                <ProviderButton active={provider === "local"} label="Local" onClick={() => { setProvider("local"); setModel(defaultModel("local")); setBaseUrl("http://localhost:11434/v1"); }} />
            </div>

            <div className="setup-fields">
                {provider === "local" ? (
                    <>
                        <label>
                            <span>Base URL</span>
                            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" />
                        </label>
                        <label>
                            <span>Model</span>
                            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="llama3.1" />
                        </label>
                    </>
                ) : (
                    <>
                        <label>
                            <span>Model</span>
                            <select value={model} onChange={(e) => setModel(e.target.value)}>
                                {providerModels.map((m) => (
                                    <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                            </select>
                        </label>
                        {provider === "openai" && (
                            <label>
                                <span>Base URL</span>
                                <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
                            </label>
                        )}
                        <label>
                            <span>API Key {hasKey ? "(set)" : "(required)"}</span>
                            <input
                                type="password"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder={hasKey ? "Leave blank to keep current key" : "Paste key"}
                                autoComplete="off"
                            />
                        </label>
                    </>
                )}
            </div>

            <div className="first-run-actions">
                <button className="btn btn-primary" onClick={apply} disabled={!canContinue}>
                    <Ico.Check size={12} />
                    <span>Save Setup</span>
                </button>
                <button className="btn" onClick={() => onSample(SAMPLE_PROMPT)}>
                    <Ico.Spark size={12} />
                    <span>Use Sample</span>
                </button>
            </div>
        </div>
    );
}

function ProviderButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
    return (
        <button className={`provider-btn${active ? " active" : ""}`} onClick={onClick}>
            <span className="provider-dot" />
            <span>{label}</span>
        </button>
    );
}

function defaultModel(provider: LlmProvider): string {
    if (provider === "openai") return "gpt-5";
    if (provider === "local") return "llama3.1";
    return "claude-opus-4-7";
}
