import type { ConversationState } from "./protocol";

export function sessionBodyFileName(conversationId: string): string {
  return `${encodeURIComponent(conversationId)}.json`;
}

export function legacySessionBodyIds(keys: string[], prefix: string): string[] {
  return keys
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
    .filter((id) => id.length > 0);
}

export function normalizeStoredConversationState(value: unknown, fallbackId: string): ConversationState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Partial<ConversationState>;
  if (!Array.isArray(raw.messages) || !Array.isArray(raw.llmMessages)) {
    return undefined;
  }
  return {
    conversationId: typeof raw.conversationId === "string" && raw.conversationId ? raw.conversationId : fallbackId,
    messages: raw.messages,
    llmMessages: raw.llmMessages,
    usage: raw.usage ?? { inputTokens: 0, outputTokens: 0 },
    lastInputTokens: raw.lastInputTokens,
    lastOutputTokens: raw.lastOutputTokens,
  };
}
