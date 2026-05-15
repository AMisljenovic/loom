import { useState } from "react";
import type { LlmConfigView } from "../../../../src/shared/protocol";
import * as Ico from "../../brand/icons";
import { post } from "../../vscode";

interface ModelPopoverProps {
    config: LlmConfigView | null;
    onClose: () => void;
}

const MODELS: Record<string, { label: string; value: string }[]> = {
    anthropic: [
        { label: "Claude 3.7 Sonnet", value: "claude-3-7-sonnet-20250219" },
        { label: "Claude 3.5 Sonnet", value: "claude-3-5-sonnet-20241022" },
        { label: "Claude 3.5 Haiku", value: "claude-3-5-haiku-20241022" },
    ],
    openai: [
        { label: "GPT-4o", value: "gpt-4o" },
        { label: "GPT-4o Mini", value: "gpt-4o-mini" },
        { label: "o3 Mini", value: "o3-mini" },
    ],
};

export function ModelPopover({ config, onClose }: ModelPopoverProps) {
    const [provider, setProvider] = useState<"anthropic" | "openai">(
        config?.provider === "openai" ? "openai" : "anthropic"
    );
    const [model, setModel] = useState(config?.model ?? "");
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? "");

    const apply = () => {
        post({
            type: "setLlmConfig",
            config: { provider, model, baseUrl: baseUrl || undefined },
        });
        if (apiKey.trim()) {
            post({ type: "setSecret", provider, apiKey: apiKey.trim() });
        }
        onClose();
    };

    const providerModels = MODELS[provider] ?? [];

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
                    onChange={(e) => setProvider(e.target.value as "anthropic" | "openai")}
                >
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                </select>

                <label className="pop-label">Model</label>
                <select
                    className="pop-select"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                >
                    {providerModels.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                </select>

                {config?.baseUrl !== undefined && (
                    <>
                        <label className="pop-label">Base URL</label>
                        <input
                            className="pop-input"
                            type="text"
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            placeholder="https://..."
                        />
                    </>
                )}

                <label className="pop-label">API Key {config?.hasApiKey ? "(set)" : "(not set)"}</label>
                <input
                    className="pop-input"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={config?.hasApiKey ? "Update key…" : "Enter key…"}
                    autoComplete="off"
                />

                <button className="pop-apply" onClick={apply}>Apply</button>
            </div>
        </div>
    );
}
