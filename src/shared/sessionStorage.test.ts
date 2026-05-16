import { describe, expect, it } from "vitest";
import { legacySessionBodyIds, normalizeStoredConversationState, sessionBodyFileName } from "./sessionStorage";

describe("session storage helpers", () => {
  it("creates a safe JSON filename from conversation IDs", () => {
    expect(sessionBodyFileName("abc/def ghi")).toBe("abc%2Fdef%20ghi.json");
  });

  it("normalizes valid stored conversation bodies", () => {
    expect(normalizeStoredConversationState({
      conversationId: "c1",
      messages: [],
      llmMessages: [],
    }, "fallback")).toEqual({
      conversationId: "c1",
      messages: [],
      llmMessages: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      lastInputTokens: undefined,
      lastOutputTokens: undefined,
    });
  });

  it("rejects malformed stored conversation bodies", () => {
    expect(normalizeStoredConversationState({ conversationId: "c1" }, "fallback")).toBeUndefined();
    expect(normalizeStoredConversationState(undefined, "fallback")).toBeUndefined();
  });

  it("finds legacy workspaceState session body keys", () => {
    expect(legacySessionBodyIds([
      "loom.sessions.index",
      "loom.sessions.body:abc",
      "loom.sessions.body:def",
      "loom.sessions.body:",
      "other",
    ], "loom.sessions.body:")).toEqual(["abc", "def"]);
  });
});
