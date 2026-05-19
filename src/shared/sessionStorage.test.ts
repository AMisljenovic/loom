import { describe, expect, it } from "vitest";
import {
  computeWorkspaceFingerprint,
  indexMatchesWorkspace,
  legacySessionBodyIds,
  normalizeStoredConversationState,
  sessionBodyFileName,
} from "./sessionStorage";
import type { SessionsIndex } from "./protocol";

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

  it("produces a stable 16-char fingerprint per workspace identity", () => {
    const a = computeWorkspaceFingerprint("file:///c/projects/a");
    const b = computeWorkspaceFingerprint("file:///c/projects/b");
    expect(a).toHaveLength(16);
    expect(a).not.toEqual(b);
    expect(computeWorkspaceFingerprint("file:///c/projects/a")).toEqual(a);
  });

  it("collapses undefined/empty identity to the no-folder fingerprint", () => {
    const noFolder = computeWorkspaceFingerprint("no-folder");
    expect(computeWorkspaceFingerprint(undefined)).toEqual(noFolder);
    expect(computeWorkspaceFingerprint("")).toEqual(noFolder);
  });

  it("accepts an index with matching fingerprint", () => {
    const fp = computeWorkspaceFingerprint("file:///proj");
    const idx: Pick<SessionsIndex, "workspaceFingerprint"> = { workspaceFingerprint: fp };
    expect(indexMatchesWorkspace(idx, fp)).toBe(true);
  });

  it("rejects an index with a foreign fingerprint", () => {
    const idx: Pick<SessionsIndex, "workspaceFingerprint"> = {
      workspaceFingerprint: computeWorkspaceFingerprint("file:///other"),
    };
    expect(indexMatchesWorkspace(idx, computeWorkspaceFingerprint("file:///proj"))).toBe(false);
  });

  it("tolerates a legacy index that has no fingerprint yet", () => {
    const idx: Pick<SessionsIndex, "workspaceFingerprint"> = {};
    expect(indexMatchesWorkspace(idx, computeWorkspaceFingerprint("file:///proj"))).toBe(true);
  });

  it("rejects undefined index", () => {
    expect(indexMatchesWorkspace(undefined, "anything")).toBe(false);
  });
});
