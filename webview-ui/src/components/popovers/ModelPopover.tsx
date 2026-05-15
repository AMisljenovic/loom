import { useState } from "react";
import type { LlmConfigView, LlmProvider } from "../../../../src/shared/protocol";
import * as Ico from "../../brand/icons";
import { post } from "../../vscode";

interface ModelPopoverProps {
    config: LlmConfigView | null;
    onClose: () => void;
}

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

export function ModelPopover({ config, onClose }: ModelPopoverProps) {
    const [provider, setProvider] = useState<LlmProvider>(config?.provider ?? "anthropic");
    const [model, setModel] = useState(config?.model ?? defaultModel(config?.provider ?? "anthropic"));
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? "");

    const apply = () => {
        if (provider !== "local" && apiKey.trim()) {
            post({ type: "setSecret", provider, apiKey: apiKey.trim() });
        }
        post({
            type: "setLlmConfig",
            config: { provider, model: model || defaultModel(provider), baseUrl: baseUrl || undefined },
        });
        onClose();
    };

    const providerModels = provider === "local" ? [] : MODELS[provider];

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
                        }
                    }}
                >
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                    <option value="local">Local</option>
                </select>

                <label className="pop-label">Model</label>
                {provider === "local" ? (
                    <input
                        className="pop-input"
                        type="text"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder="llama3.1"
                    />
                ) : (
                    <select
                        className="pop-select"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                    >
                        {providerModels.map((m) => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                    </select>
                )}

                {(provider === "openai" || provider === "local") && (
                    <>
                        <label className="pop-label">Base URL</label>
                        <input
                            className="pop-input"
                            type="text"
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            placeholder={provider === "local" ? "http://localhost:11434/v1" : "https://api.openai.com/v1"}
                        />
                    </>
                )}

                {provider !== "local" && (
                    <>
                        <label className="pop-label">API Key {config?.apiKeys?.[provider] ? "(set)" : "(not set)"}</label>
                        <input
                            className="pop-input"
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder={config?.apiKeys?.[provider] ? "Update key..." : "Enter key..."}
                            autoComplete="off"
                        />
                    </>
                )}

                <button className="pop-apply" onClick={apply}>Apply</button>
            </div>
        </div>
    );
}

function defaultModel(provider: LlmProvider): string {
    if (provider === "openai") return "gpt-5";
    if (provider === "local") return "llama3.1";
    return "claude-opus-4-7";
}
