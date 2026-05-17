import { useEffect, useMemo, useState } from "react";
import type { LlmConfigView, LlmProvider } from "../../../../src/shared/protocol";
import * as Ico from "../../brand/icons";
import { post } from "../../vscode";
import { defaultModel, modelSuggestions, providerNeedsBaseUrl, providerNeedsKey } from "../../util/provider";

interface ModelPopoverProps {
    config: LlmConfigView | null;
    onClose: () => void;
    onOpenSettings: () => void;
}

const OTHER_VALUE = "__other__";

export function ModelPopover({ config, onClose, onOpenSettings }: ModelPopoverProps) {
    const [provider, setProvider] = useState<LlmProvider>(config?.provider ?? "anthropic");
    const [model, setModel] = useState(config?.model ?? defaultModel(config?.provider ?? "anthropic"));
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? "");

    useEffect(() => {
        setProvider(config?.provider ?? "anthropic");
        setModel(config?.model ?? defaultModel(config?.provider ?? "anthropic"));
        setBaseUrl(config?.baseUrl ?? "");
    }, [config?.provider, config?.model, config?.baseUrl]);

    const suggestions = useMemo(() => modelSuggestions(provider), [provider]);
    const inSuggestions = suggestions.some((m) => m.value === model);
    const [selectMode, setSelectMode] = useState<"preset" | "other">(inSuggestions ? "preset" : "other");

    useEffect(() => {
        setSelectMode(inSuggestions ? "preset" : "other");
    }, [inSuggestions]);

    const apply = () => {
        if (providerNeedsKey(provider) && apiKey.trim()) {
            post({ type: "setSecret", provider, apiKey: apiKey.trim() });
        }
        post({
            type: "setLlmConfig",
            config: {
                provider,
                model: model || defaultModel(provider),
                baseUrl: providerNeedsBaseUrl(provider) ? (baseUrl || undefined) : undefined,
                advanced: config?.advanced,
            },
        });
        onClose();
    };

    return (
        <div className="popover model-pop">
            <div className="pop-head">
                <span>Model settings</span>
                <button className="icon-button" onClick={onClose} aria-label="Close">
                    <Ico.Close size={12} />
                </button>
            </div>
            <div className="pop-body">
                <label className="pop-label">Provider</label>
                <select
                    className="pop-select"
                    value={provider}
                    onChange={(e) => {
                        const next = e.target.value as LlmProvider;
                        setProvider(next);
                        setModel(defaultModel(next));
                        if (next === "local") {
                            setBaseUrl("http://localhost:11434/v1");
                        } else if (next === "anthropic") {
                            setBaseUrl("");
                        } else if (next === "openai") {
                            setBaseUrl("");
                        } else if (next === "openai-compatible") {
                            setBaseUrl(config?.baseUrl ?? "");
                        }
                    }}
                >
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                    <option value="openai-compatible">OpenAI-Compatible</option>
                    <option value="local">Local</option>
                </select>

                <label className="pop-label">Model</label>
                <select
                    className="pop-select"
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
                {selectMode === "other" && (
                    <input
                        className="pop-input"
                        type="text"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder="Type a model id"
                        autoComplete="off"
                    />
                )}

                {providerNeedsBaseUrl(provider) && (
                    <>
                        <label className="pop-label">Base URL</label>
                        <input
                            className="pop-input"
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
                    </>
                )}

                {providerNeedsKey(provider) && (
                    <>
                        <label className="pop-label">
                            API Key {config?.apiKeys?.[provider] ? "(set)" : "(not set)"}
                        </label>
                        <input
                            className="pop-input"
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder={config?.apiKeys?.[provider] ? "Update key…" : "Enter key…"}
                            autoComplete="off"
                        />
                    </>
                )}

                <button className="pop-apply" onClick={apply}>Apply</button>
                <button
                    className="pop-link"
                    onClick={() => {
                        onClose();
                        onOpenSettings();
                    }}
                >
                    Advanced settings…
                </button>
            </div>
        </div>
    );
}
