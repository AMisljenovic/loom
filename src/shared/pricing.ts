import type { ConversationUsage } from "./protocol";

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

const exactPricing: Record<string, ModelPricing> = {
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-haiku-4-5-20251001": { inputPerMTok: 1, outputPerMTok: 5 },
  "gpt-5.5": { inputPerMTok: 5, outputPerMTok: 30 },
  "gpt-5.4": { inputPerMTok: 2.5, outputPerMTok: 15 },
  "gpt-5.4-mini": { inputPerMTok: 0.75, outputPerMTok: 4.5 },
  "gpt-5.4-nano": { inputPerMTok: 0.2, outputPerMTok: 1.25 },
  "gpt-5.3-codex": { inputPerMTok: 1.75, outputPerMTok: 14 },
};

export function pricingForModel(model: string | undefined): ModelPricing | undefined {
  if (!model) return undefined;
  return exactPricing[model.toLowerCase()];
}

export function estimateCost(usage: ConversationUsage): number | undefined {
  const pricing = pricingForModel(usage.model);
  if (!pricing) return undefined;
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMTok +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMTok
  );
}
