import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Msg } from "../../../../src/shared/protocol";
import { nextTurnLimit, StopCard, TodoCard } from "./Thread";

describe("TodoCard", () => {
    it("renders live todo status compactly", () => {
        const msg: Extract<Msg, { role: "todo" }> = {
            role: "todo",
            taskId: "task-1",
            title: "Update Todos",
            items: [
                { id: "one", text: "Read files", status: "done" },
                { id: "two", text: "Patch UI", status: "in_progress" },
                { id: "three", text: "Run tests", status: "pending" },
            ],
        };

        const html = renderToStaticMarkup(<TodoCard msg={msg} />);

        expect(html).toContain("Update Todos");
        expect(html).toContain("1/3");
        expect(html).toContain("Read files");
        expect(html).toContain("Patch UI");
        expect(html).toContain("Run tests");
        expect(html).toContain("todo-in_progress");
    });
});

describe("StopCard", () => {
    it("renders the stop reason and continue action", () => {
        const msg: Extract<Msg, { role: "stop" }> = {
            role: "stop",
            taskId: "task-1",
            title: "Stopped at turn limit",
            text: "Loom reached 32 model/tool turns after 2m.",
            reason: "turn_limit",
            canContinue: true,
            continuePrompt: "continue",
            maxTurns: 32,
        };

        const html = renderToStaticMarkup(<StopCard msg={msg} busy={false} onContinue={() => { }} />);

        expect(html).toContain("Stopped at turn limit");
        expect(html).toContain("Loom reached 32 model/tool turns");
        expect(html).toContain("Continue");
        expect(html).toContain("stop-turn_limit");
    });

    it("renders the doubled next turn cap on a turn_limit stop", () => {
        const msg: Extract<Msg, { role: "stop" }> = {
            role: "stop",
            title: "Stopped at turn limit",
            text: "limit",
            reason: "turn_limit",
            canContinue: true,
            maxTurns: 32,
        };
        const html = renderToStaticMarkup(<StopCard msg={msg} busy={false} onContinue={() => { }} />);
        expect(html).toContain("cap 64");
    });

});

describe("nextTurnLimit", () => {
    it("doubles a known previous cap", () => {
        expect(nextTurnLimit(32)).toBe(64);
        expect(nextTurnLimit(64)).toBe(128);
        expect(nextTurnLimit(128)).toBe(256);
    });
    it("falls back to twice the default when no previous cap is known", () => {
        expect(nextTurnLimit(undefined)).toBe(64);
        expect(nextTurnLimit(0)).toBe(64);
    });
});
