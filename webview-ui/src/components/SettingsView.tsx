import { useEffect, useMemo, useState } from "react";
import type {
    AdvancedLlmOptions,
    CustomHeader,
    LlmConfigView,
    LlmProvider,
    ReasoningEffort,
} from "../../../src/shared/protocol";
import * as Ico from "../brand/icons";
import { post } from "../vscode";
import {
    OPENAI_COMPATIBLE_PRESETS,
    defaultCompatiblePresetId,
    defaultModel,
    detectPreset,
    modelSuggestions,
    presetById,
    providerLabel,
    providerNeedsBaseUrl,
    providerNeedsKey,
    providerSubtitle,
    providerSupportsReasoning,
} from "../util/provider";

interface SettingsViewProps {
    config: LlmConfigView | null;
    onClose: () => void;
}

const OTHER_VALUE = "__other__";
const PROVIDERS: LlmProvider[] = ["anthropic", "openai", "openai-compatible", "local"];

interface FormHeader extends CustomHeader {
    id: string;
}

let headerCounter = 0;
const nextHeaderId = () => `h-${++headerCounter}`;

function toFormHeaders(input: CustomHeader[] | undefined): FormHeader[] {
    if (!input) return [];
    return input.map((h) => ({ ...h, id: nextHeaderId() }));
}

export function SettingsView({ config, onClose }: SettingsViewProps) {
    const initialProvider = config?.provider ?? "anthropic";
    const initialPresetId = initialProvider === "openai-compatible"
        ? detectPreset(config?.baseUrl).id
        : defaultCompatiblePresetId();
    const [provider, setProvider] = useState<LlmProvider>(initialProvider);
    const [presetId, setPresetId] = useState<string>(initialPresetId);
    const [model, setModel] = useState(config?.model ?? defaultModel(initialProvider, initialPresetId));
    const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? "");
    const [apiKey, setApiKey] = useState("");

    const initialAdvanced = config?.advanced;
    const [maxOutput, setMaxOutput] = useState<string>(
        initialAdvanced?.maxOutputTokens ? String(initialAdvanced.maxOutputTokens) : "",
    );
    const [contextWindow, setContextWindow] = useState<string>(
        initialAdvanced?.contextWindow ? String(initialAdvanced.contextWindow) : "",
    );
    const [reasoning, setReasoning] = useState<ReasoningEffort>(
        (initialAdvanced?.reasoningEffort ?? config?.reasoningEffort ?? "") as ReasoningEffort,
    );
    const [headers, setHeaders] = useState<FormHeader[]>(toFormHeaders(initialAdvanced?.customHeaders));

    useEffect(() => {
        if (!config) return;
        setProvider(config.provider);
        setModel(config.model);
        setBaseUrl(config.baseUrl ?? "");
        setPresetId(config.provider === "openai-compatible"
            ? detectPreset(config.baseUrl).id
            : defaultCompatiblePresetId());
        setMaxOutput(config.advanced?.maxOutputTokens ? String(config.advanced.maxOutputTokens) : "");
        setContextWindow(config.advanced?.contextWindow ? String(config.advanced.contextWindow) : "");
        setReasoning((config.advanced?.reasoningEffort ?? config.reasoningEffort ?? "") as ReasoningEffort);
        setHeaders(toFormHeaders(config.advanced?.customHeaders));
    }, [config?.provider]);

    const suggestions = useMemo(
        () => modelSuggestions(provider, presetId),
        [provider, presetId],
    );
    const activePreset = provider === "openai-compatible" ? presetById(presetId) : null;
    const inSuggestions = suggestions.some((m) => m.value === model);
    const [modelMode, setModelMode] = useState<"preset" | "other">(inSuggestions ? "preset" : "other");
    useEffect(() => {
        setModelMode(inSuggestions ? "preset" : "other");
    }, [inSuggestions]);

    const needsKey = providerNeedsKey(provider);
    const hasKey = !needsKey || Boolean(config?.apiKeys?.[provider as "anthropic" | "openai" | "openai-compatible"]);

    const pickProvider = (next: LlmProvider) => {
        setProvider(next);
        if (next === "local") {
            setBaseUrl("http://localhost:11434/v1");
            setModel(defaultModel(next));
        } else if (next === "anthropic" || next === "openai") {
            setBaseUrl("");
            setModel(defaultModel(next));
        } else if (next === "openai-compatible") {
            const id = defaultCompatiblePresetId();
            setPresetId(id);
            const preset = presetById(id);
            setBaseUrl(preset.baseUrl);
            setModel(defaultModel(next, id));
        }
        setApiKey("");
    };

    const pickPreset = (nextId: string) => {
        setPresetId(nextId);
        const preset = presetById(nextId);
        setBaseUrl(preset.baseUrl);
        setModel(defaultModel("openai-compatible", nextId));
    };

    const save = () => {
        if (needsKey && apiKey.trim()) {
            post({
                type: "setSecret",
                provider: provider as "anthropic" | "openai" | "openai-compatible",
                apiKey: apiKey.trim(),
            });
        }
        const advanced: AdvancedLlmOptions = {};
        const mo = Number.parseInt(maxOutput, 10);
        if (Number.isFinite(mo) && mo > 0) advanced.maxOutputTokens = mo;
        const cw = Number.parseInt(contextWindow, 10);
        if (Number.isFinite(cw) && cw > 0) advanced.contextWindow = cw;
        if (providerSupportsReasoning(provider) && reasoning) advanced.reasoningEffort = reasoning;
        const cleanHeaders = headers
            .map((h): CustomHeader => ({ name: h.name.trim(), value: h.value }))
            .filter((h) => h.name);
        if (cleanHeaders.length > 0) advanced.customHeaders = cleanHeaders;

        post({
            type: "setLlmConfig",
            config: {
                provider,
                model: model || defaultModel(provider),
                baseUrl: providerNeedsBaseUrl(provider) ? (baseUrl || undefined) : undefined,
                advanced: Object.keys(advanced).length > 0 ? advanced : undefined,
            },
        });
        onClose();
    };

    const addHeader = () => setHeaders((prev) => [...prev, { id: nextHeaderId(), name: "", value: "" }]);
    const updateHeader = (id: string, patch: Partial<CustomHeader>) =>
        setHeaders((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)));
    const removeHeader = (id: string) => setHeaders((prev) => prev.filter((h) => h.id !== id));

    return (
        <div className="settings-view">
            <div className="settings-head">
                <h2>Settings</h2>
                <button className="icon-button" onClick={onClose} aria-label="Close settings">
                    <Ico.Close size={14} />
                </button>
            </div>

            <section className="settings-section">
                <h3>Provider & Model</h3>

                <div className="provider-grid">
                    {PROVIDERS.map((p) => (
                        <button
                            key={p}
                            className={`provider-btn${provider === p ? " active" : ""}`}
                            onClick={() => pickProvider(p)}
                        >
                            <span className="provider-btn-title">
                                <span className="provider-dot" />
                                <span>{providerLabel(p)}</span>
                            </span>
                            <span className="provider-btn-sub">{providerSubtitle(p)}</span>
                        </button>
                    ))}
                </div>

                <div className="settings-fields">
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
                                type="text"
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
                            value={modelMode === "other" ? OTHER_VALUE : model}
                            onChange={(e) => {
                                const v = e.target.value;
                                if (v === OTHER_VALUE) {
                                    setModelMode("other");
                                    return;
                                }
                                setModelMode("preset");
                                setModel(v);
                            }}
                        >
                            {suggestions.map((m) => (
                                <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                            <option value={OTHER_VALUE}>Other…</option>
                        </select>
                    </label>
                    {modelMode === "other" && (
                        <label>
                            <span>Model id</span>
                            <input
                                type="text"
                                value={model}
                                onChange={(e) => setModel(e.target.value)}
                                placeholder="Type a model id"
                            />
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
            </section>

            <details className="settings-section settings-advanced">
                <summary>Advanced</summary>
                <div className="settings-fields">
                    <label>
                        <span>Max output tokens</span>
                        <input
                            type="number"
                            min={0}
                            value={maxOutput}
                            onChange={(e) => setMaxOutput(e.target.value)}
                            placeholder="Leave blank for server default"
                        />
                    </label>
                    <label>
                        <span>Context window override</span>
                        <input
                            type="number"
                            min={0}
                            value={contextWindow}
                            onChange={(e) => setContextWindow(e.target.value)}
                            placeholder="Leave blank to use the model default"
                        />
                    </label>
                    {providerSupportsReasoning(provider) && (
                        <label>
                            <span>Reasoning effort</span>
                            <select
                                value={reasoning}
                                onChange={(e) => setReasoning(e.target.value as ReasoningEffort)}
                            >
                                <option value="">None</option>
                                <option value="low">Low</option>
                                <option value="medium">Medium</option>
                                <option value="high">High</option>
                            </select>
                        </label>
                    )}

                    <div className="custom-headers">
                        <div className="custom-headers-head">
                            <span>Custom headers</span>
                            <button className="btn btn-sm" onClick={addHeader}>+ Add header</button>
                        </div>
                        {headers.length === 0 && (
                            <p className="settings-hint">No custom headers. Add one to send extra HTTP headers with every LLM request.</p>
                        )}
                        {headers.map((h) => (
                            <div className="custom-header-row" key={h.id}>
                                <input
                                    type="text"
                                    value={h.name}
                                    onChange={(e) => updateHeader(h.id, { name: e.target.value })}
                                    placeholder="Header name"
                                />
                                <input
                                    type="text"
                                    value={h.value}
                                    onChange={(e) => updateHeader(h.id, { value: e.target.value })}
                                    placeholder="Value"
                                />
                                <button className="icon-button" onClick={() => removeHeader(h.id)} aria-label="Remove header">
                                    <Ico.Close size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </details>

            <div className="settings-actions">
                <button className="btn btn-primary" onClick={save}>Save</button>
                <button className="btn" onClick={onClose}>Cancel</button>
            </div>
        </div>
    );
}
