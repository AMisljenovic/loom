import { describe, expect, it } from "vitest";
import { shouldAppendProgress } from "./progress";
import type { Msg } from "./protocol";

describe("progress helpers", () => {
  it("deduplicates adjacent progress notes", () => {
    const messages: Msg[] = [
      { role: "progress", phase: "reading", text: "Reading src/App.tsx", createdAt: 1 },
    ];
    expect(shouldAppendProgress(messages, "reading", "Reading   src/App.tsx")).toBe(false);
    expect(shouldAppendProgress(messages, "searching", "Searching src/App.tsx")).toBe(true);
  });

  it("deduplicates punctuation and casing variants", () => {
    const messages: Msg[] = [
      { role: "progress", phase: "thinking", text: "Continuing with your answers.", createdAt: 1 },
    ];
    expect(shouldAppendProgress(messages, "thinking", "continuing   with your answers")).toBe(false);
  });

  it("allows the same note after other message kinds", () => {
    const messages: Msg[] = [
      { role: "progress", phase: "reading", text: "Reading src/App.tsx", createdAt: 1 },
      { role: "assistant", text: "Done" },
    ];
    expect(shouldAppendProgress(messages, "reading", "Reading src/App.tsx")).toBe(true);
  });
});
