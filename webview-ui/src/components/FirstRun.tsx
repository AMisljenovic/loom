import { useEffect, useMemo, useState } from "react";
import type { FirstRunState, LlmProvider } from "../../../src/shared/protocol";
import { LoomMark } from "../brand/LoomMark";
import * as Ico from "../brand/icons";
import { post } from "../vscode";
import {
    OPENAI_COMPATIBLE_PRESETS,
    defaultCompatiblePresetId,
    defaultModel,
    detectPreset,
    modelSuggestions,
    presetById,
    providerNeedsBaseUrl,
    providerNeedsKey,
    providerSubtitle,
} from "../util/provider";

interface FirstRunProps {
    state: FirstRunState;
    onSample: (prompt: string) => void;
}

const SAMPLE_PROMPT = "What does this project do? Read the README and summarize the main architecture.";
const OTHER_VALUE = "__other__";

export function FirstRun({ state, onSample }: FirstRunProps) {
    const [provider, setProvider] = useState<LlmProvider>(state.llmConfig.provider);
    const [presetId, setPresetId] = useState<string>(
        state.llmConfig.provider === "openai-compatible"
            ? detectPreset(state.llmConfig.baseUrl).id
            : defaultCompatiblePresetId(),
    );
    const [model, setModel] = useState(state.llmConfig.model);
    const [baseUrl, setBaseUrl] = useState(state.llmConfig.baseUrl ?? "http://localhost:11434/v1");
    const [apiKey, setApiKey] = useState("");

    useEffect(() => {
        setProvider(state.llmConfig.provider);
        setModel(state.llmConfig.model);
        setBaseUrl(state.llmConfig.baseUrl ?? "http://localhost:11434/v1");
        setPresetId(state.llmConfig.provider === "openai-compatible"
            ? detectPreset(state.llmConfig.baseUrl).id
            : defaultCompatiblePresetId());
    }, [state.llmConfig.provider, state.llmConfig.model, state.llmConfig.baseUrl]);

    const suggestions = useMemo(
        () => modelSuggestions(provider, presetId),
        [provider, presetId],
    );
    const activePreset = provider === "openai-compatible" ? presetById(presetId) : null;
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
        if (next === "local") {
            setBaseUrl("http://localhost:11434/v1");
            setModel(defaultModel(next));
        } else if (next === "openai-compatible") {
            const id = defaultCompatiblePresetId();
            setPresetId(id);
            const preset = presetById(id);
            setBaseUrl(preset.baseUrl);
            setModel(defaultModel(next, id));
        } else {
            setBaseUrl("");
            setModel(defaultModel(next));
        }
    };

    const pickPreset = (nextId: string) => {
        setPresetId(nextId);
        const preset = presetById(nextId);
        setBaseUrl(preset.baseUrl);
        setModel(defaultModel("openai-compatible", nextId));
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
                <ProviderButton active={provider === "anthropic"} label="Anthropic" sub={providerSubtitle("anthropic")} onClick={() => pickProvider("anthropic")} />
                <ProviderButton active={provider === "openai"} label="OpenAI" sub={providerSubtitle("openai")} onClick={() => pickProvider("openai")} />
                <ProviderButton active={provider === "openai-compatible"} label="More Providers" sub={providerSubtitle("openai-compatible")} onClick={() => pickProvider("openai-compatible")} />
                <ProviderButton active={provider === "local"} label="Local" sub={providerSubtitle("local")} onClick={() => pickProvider("local")} />
            </div>

            <div className="setup-fields">
                {provider === "openai-compatible" && (
                    <label>
                        <span>Preset</span>
                        <select
                            value={presetId}
                            onChange={(e) => pickPreset(e.target.value)}
                        >
                            {OPENAI_COMPATIBLE_PRESETS.map((p) => (
                                <option key={p.id} value={p.id}>{p.label}</option>
                            ))}
                        </select>
                    </label>
                )}
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
                        <span>
                            API Key {hasKey ? "(set)" : "(required)"}
                            {activePreset?.keyHintUrl && (
                                <>
                                    {" — "}
                                    <a
                                        href={activePreset.keyHintUrl}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                    >
                                        {activePreset.keyHintLabel ?? "Get a key"} →
                                    </a>
                                </>
                            )}
                        </span>
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

function ProviderButton({ active, label, sub, onClick }: { active: boolean; label: string; sub: string; onClick: () => void }) {
    return (
        <button className={`provider-btn${active ? " active" : ""}`} onClick={onClick}>
            <span className="provider-btn-title">
                <span className="provider-dot" />
                <span>{label}</span>
            </span>
            <span className="provider-btn-sub">{sub}</span>
        </button>
    );
}
