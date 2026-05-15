import { describe, expect, it } from "vitest";
import { detectModeSwitchIntent } from "./modeIntent";
import type { ModeDefinition } from "./protocol";

const modes: ModeDefinition[] = [
  { id: "code", label: "Code" },
  { id: "architect", label: "Architect" },
  { id: "ask", label: "Ask" },
  { id: "debug", label: "Debug" },
];

describe("detectModeSwitchIntent", () => {
  it("switches to code mode and keeps the remaining task", () => {
    expect(detectModeSwitchIntent("switch to code mode and implement", modes)).toEqual({
      modeId: "code",
      label: "Code",
      prompt: "implement",
    });
  });

  it("switches to architect mode without starting a new task", () => {
    expect(detectModeSwitchIntent("use architect mode", modes)).toEqual({
      modeId: "architect",
      label: "Architect",
      prompt: undefined,
    });
  });

  it("treats continue in debug mode as a continue task", () => {
    expect(detectModeSwitchIntent("continue in debug mode", modes)).toEqual({
      modeId: "debug",
      label: "Debug",
      prompt: "continue",
    });
  });

  it("ignores normal prompts that merely mention modes", () => {
    expect(detectModeSwitchIntent("what is code mode?", modes)).toBeUndefined();
    expect(detectModeSwitchIntent("explain why architect mode cannot edit files", modes)).toBeUndefined();
  });
});
