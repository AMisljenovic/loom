import { useEffect, useMemo, useState } from "react";
import type { FirstRunState, LlmProvider } from "../../../src/shared/protocol";
import { LoomMark } from "../brand/LoomMark";
import * as Ico from "../brand/icons";
import { post } from "../vscode";
import { defaultModel, modelSuggestions, providerNeedsBaseUrl, providerNeedsKey } from "../util/provider";

interface FirstRunProps {
    state: FirstRunState;
    onSample: (prompt: string) => void;
}

const SAMPLE_PROMPT = "What does this project do? Read the README and summarize the main architecture.";
const OTHER_VALUE = "__other__";

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

    const suggestions = useMemo(() => modelSuggestions(provider), [provider]);
    const inSuggestions = suggestions.some((m) => m.value === model);
    const [selectMode, setSelectMode] = useState<"preset" | "other">(inSuggestions ? "preset" : "other");
    useEffect(() => {
        setSelectMode(inSuggestions ? "preset" : "other");
    }, [inSuggestions]);

    const needsKey = providerNeedsKey(provider);
    const hasKey = !needsKey || Boolean(state.llmConfig.apiKeys?.[provider as "anthropic" | "openai" | "openai-compatible"]);
    const canContinue = !needsKey || hasKey || apiKey.trim().length > 0;

    const apply = () => {
        if (needsKey && apiKey.trim()) {
            post({ type: "setSecret", provider: provider as "anthropic" | "openai" | "openai-compatible", apiKey: apiKey.trim() });
        }
        post({
            type: "setLlmConfig",
            config: {
                provider,
                model: model || defaultModel(provider),
                baseUrl: providerNeedsBaseUrl(provider) ? (baseUrl || undefined) : undefined,
            },
        });
        post({ type: "completeFirstRun" });
    };

    const pickProvider = (next: LlmProvider) => {
        setProvider(next);
        setModel(defaultModel(next));
        if (next === "local") {
            setBaseUrl("http://localhost:11434/v1");
        } else if (next === "openai-compatible") {
            setBaseUrl(state.llmConfig.baseUrl ?? "");
        }
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
                <ProviderButton active={provider === "anthropic"} label="Anthropic" onClick={() => pickProvider("anthropic")} />
                <ProviderButton active={provider === "openai"} label="OpenAI" onClick={() => pickProvider("openai")} />
                <ProviderButton active={provider === "openai-compatible"} label="OpenAI-Compatible" onClick={() => pickProvider("openai-compatible")} />
                <ProviderButton active={provider === "local"} label="Local" onClick={() => pickProvider("local")} />
            </div>

            <div className="setup-fields">
                {providerNeedsBaseUrl(provider) && (
                    <label>
                        <span>Base URL</span>
                        <input
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            placeholder={
                                provider === "local"
                                    ? "http://localhost:11434/v1"
                                    : provider === "openai-compatible"
                                        ? "https://your-endpoint/v1"
                                        : "https://api.openai.com/v1"
                            }
                        />
                    </label>
                )}
                <label>
                    <span>Model</span>
                    <select
                        value={selectMode === "other" ? OTHER_VALUE : model}
                        onChange={(e) => {
                            const v = e.target.value;
                            if (v === OTHER_VALUE) {
                                setSelectMode("other");
                                return;
                            }
                            setSelectMode("preset");
                            setModel(v);
                        }}
                    >
                        {suggestions.map((m) => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                        <option value={OTHER_VALUE}>Other…</option>
                    </select>
                </label>
                {selectMode === "other" && (
                    <label>
                        <span>Model id</span>
                        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Type a model id" />
                    </label>
                )}
                {needsKey && (
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
