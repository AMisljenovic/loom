import { createHash } from "node:crypto";

import type { ConversationState, SessionsIndex } from "./protocol";

export function sessionBodyFileName(conversationId: string): string {
  return `${encodeURIComponent(conversationId)}.json`;
}

// computeWorkspaceFingerprint hashes whatever identity VS Code exposes for the
// current workspace (workspace file URI, first folder URI, or a literal
// "no-folder" sentinel) so we can detect — and reject — a sessions index that
// was persisted by a different workspace.
export function computeWorkspaceFingerprint(identity: string | undefined): string {
  const value = identity && identity.length > 0 ? identity : "no-folder";
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

// indexMatchesWorkspace returns true when the loaded index either has no
// fingerprint (legacy: tolerated once and stamped on next save) or carries the
// expected fingerprint. A mismatch indicates cross-workspace bleed and the
// caller should treat the index as foreign.
export function indexMatchesWorkspace(
  index: Pick<SessionsIndex, "workspaceFingerprint"> | undefined,
  expected: string,
): boolean {
  if (!index) return false;
  if (index.workspaceFingerprint === undefined) return true;
  return index.workspaceFingerprint === expected;
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
