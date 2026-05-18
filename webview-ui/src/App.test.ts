import { describe, expect, it } from "vitest";
import type { Msg, ToolApprovalItem } from "../../src/shared/protocol";
import { buildApprovalBatchDecisions, removeApprovalBatchItem, taskStopMessage, toggleToolExpanded, upsertStopMessage, upsertTodoMessage } from "./App";

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

describe("approval batch helpers", () => {
  it("removes one item and keeps the batch while others remain", () => {
    const batch = {
      batchId: "batch-1",
      items: [
        { callId: "a", name: "read_file", input: { path: "a.ts" } },
        { callId: "b", name: "search", input: { query: "foo" } },
      ] satisfies ToolApprovalItem[],
    };

    expect(removeApprovalBatchItem(batch, "a")).toEqual({
      batchId: "batch-1",
      items: [{ callId: "b", name: "search", input: { query: "foo" } }],
    });
  });

  it("returns null when removing the last item", () => {
    const batch = {
      batchId: "batch-1",
      items: [{ callId: "a", name: "read_file", input: { path: "a.ts" } }] satisfies ToolApprovalItem[],
    };

    expect(removeApprovalBatchItem(batch, "a")).toBeNull();
  });

  it("maps every batch item to one decision", () => {
    const items: ToolApprovalItem[] = [
      { callId: "a", name: "read_file", input: { path: "a.ts" } },
      { callId: "b", name: "search", input: { query: "foo" } },
    ];

    expect(buildApprovalBatchDecisions(items, "approved")).toEqual({
      a: "approved",
      b: "approved",
    });
  });
});

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

describe("upsertTodoMessage", () => {
  it("adds a todo card message for a task", () => {
    const next = upsertTodoMessage([], "task-1", "Update Todos", [
      { id: "read", text: "Read files", status: "in_progress" },
      { id: "patch", text: "Patch UI", status: "pending" },
    ]);

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      role: "todo",
      taskId: "task-1",
      title: "Update Todos",
      items: [
        { id: "read", text: "Read files", status: "in_progress" },
        { id: "patch", text: "Patch UI", status: "pending" },
      ],
    });
  });

  it("moves an existing todo card to the end on update and preserves title fallback", () => {
    const existing: Msg[] = [
      { role: "todo", taskId: "task-1", title: "Update Todos", items: [{ id: "read", text: "Read files", status: "in_progress" }] },
      tool("top"),
    ];

    const next = upsertTodoMessage(existing, "task-1", undefined, [
      { id: "read", text: "Read files", status: "done" },
    ]);

    expect(next).toHaveLength(2);
    expect(next[0]).toBe(existing[1]);
    expect(next[1]).toMatchObject({
      role: "todo",
      taskId: "task-1",
      title: "Update Todos",
      items: [{ id: "read", text: "Read files", status: "done" }],
    });
  });

  it("keeps todo cards from other tasks at their original positions", () => {
    const other: Msg = {
      role: "todo",
      taskId: "task-2",
      title: "Other",
      items: [{ id: "x", text: "Other todo", status: "pending" }],
    };
    const existing: Msg[] = [
      { role: "todo", taskId: "task-1", title: "Update Todos", items: [{ id: "read", text: "Read files", status: "in_progress" }] },
      tool("top"),
      other,
    ];

    const next = upsertTodoMessage(existing, "task-1", "New Title", [
      { id: "read", text: "Read files", status: "done" },
    ]);

    expect(next).toHaveLength(3);
    expect(next[0]).toBe(existing[1]);
    expect(next[1]).toBe(other);
    expect(next[2]).toMatchObject({
      role: "todo",
      taskId: "task-1",
      title: "New Title",
      items: [{ id: "read", text: "Read files", status: "done" }],
    });
  });
});

describe("stop messages", () => {
  it("builds a resumable turn-limit stop message with elapsed time", () => {
    const msg = taskStopMessage({
      taskId: "task-1",
      reason: "turn_limit",
      durationMs: 125_000,
      maxTurns: 32,
    });

    expect(msg).toMatchObject({
      role: "stop",
      taskId: "task-1",
      title: "Stopped at turn limit",
      reason: "turn_limit",
      canContinue: true,
    });
    expect(msg.text).toContain("32 model/tool turns");
    expect(msg.text).toContain("2m 5s");
  });

  it("updates an existing stop card in place by task id", () => {
    const first = taskStopMessage({ taskId: "task-1", reason: "error", error: "old" });
    const second = taskStopMessage({ taskId: "task-1", reason: "error", error: "new" });

    const next = upsertStopMessage([first, tool("top")], second);

    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ role: "stop", taskId: "task-1", text: "new" });
  });
});
