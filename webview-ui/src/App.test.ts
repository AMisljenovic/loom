import { describe, expect, it } from "vitest";
import type { Msg } from "../../src/shared/protocol";
import { toggleToolExpanded } from "./App";

function tool(callId: string, expanded = false): Extract<Msg, { role: "tool" }> {
  return {
    role: "tool",
    name: "read_file",
    status: "done",
    callId,
    input: { path: "src/App.tsx" },
    output: "ok",
    expanded,
  };
}

describe("toggleToolExpanded", () => {
  it("toggles a top-level tool open and closed", () => {
    const messages: Msg[] = [tool("top")];

    const opened = toggleToolExpanded(messages, "top");
    expect(opened).not.toBe(messages);
    expect(opened[0]).toMatchObject({ role: "tool", callId: "top", expanded: true });

    const closed = toggleToolExpanded(opened, "top");
    expect(closed[0]).toMatchObject({ role: "tool", callId: "top", expanded: false });
  });

  it("toggles a sub-agent trace tool without touching top-level tools", () => {
    const topTool = tool("top", false);
    const messages: Msg[] = [
      topTool,
      {
        role: "subagent",
        parentTaskId: "parent",
        subTaskId: "sub",
        type: "research",
        task: "inspect",
        status: "running",
        trace: [{ role: "assistant", text: "thinking" }, tool("nested", false)],
      },
    ];

    const opened = toggleToolExpanded(messages, "nested");
    expect(opened[0]).toBe(topTool);

    const subagent = opened[1];
    expect(subagent.role).toBe("subagent");
    if (subagent.role !== "subagent") return;
    expect(subagent.trace[1]).toMatchObject({ role: "tool", callId: "nested", expanded: true });
  });

  it("returns the original array for an unknown call id", () => {
    const messages: Msg[] = [tool("top")];

    expect(toggleToolExpanded(messages, "missing")).toBe(messages);
  });
});
