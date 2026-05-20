import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Msg } from "../../../../src/shared/protocol";
import { IntentLine, isNearBottom, nextTurnLimit, parseDiagnosticErrors, shouldAutoPin, StopCard, Thread, TodoCard } from "./Thread";

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

describe("Thread auto-follow helpers", () => {
    it("detects the bottom threshold used by auto-follow", () => {
        expect(isNearBottom(1000, 970, 20)).toBe(true);
        expect(isNearBottom(1000, 900, 20)).toBe(false);
    });

    it("respects deliberate manual scroll-away", () => {
        expect(shouldAutoPin(true, false)).toBe(true);
        expect(shouldAutoPin(true, true)).toBe(false);
        expect(shouldAutoPin(false, false)).toBe(false);
    });

    it("renders a bottom sentinel for completion pinning", () => {
        const html = renderToStaticMarkup(
            <Thread
                messages={[{ role: "assistant", text: "Done", kind: "summary" }]}
                pendingDiffs={new Map()}
                pendingOutputs={new Map()}
                busy={false}
                onToggleToolExpanded={() => { }}
                onContinue={() => { }}
                pinSignal={1}
            />,
        );

        expect(html).toContain("thread-bottom-sentinel");
        expect(html).toContain("Summary");
    });
});

describe("diagnostics rendering", () => {
    const raw = '<error file="radio_player/gui.py" line="26" column="1">Expected class body after class definition</error> <error file="radio_player/gui_parts/actions.py" line="13" column="5">&quot;search_stations&quot; is not defined</error>';

    it("parses raw diagnostic error tags", () => {
        expect(parseDiagnosticErrors(raw)).toEqual([
            {
                file: "radio_player/gui.py",
                line: "26",
                column: "1",
                message: "Expected class body after class definition",
            },
            {
                file: "radio_player/gui_parts/actions.py",
                line: "13",
                column: "5",
                message: '"search_stations" is not defined',
            },
        ]);
    });

    it("renders raw diagnostic tags as a diagnostics card instead of reasoning text", () => {
        const html = renderToStaticMarkup(<IntentLine text={raw} id="assistant-1" />);

        expect(html).toContain("diagnostics-card");
        expect(html).toContain("Diagnostics");
        expect(html).toContain("radio_player/gui.py:26:1");
        expect(html).toContain("Expected class body after class definition");
        expect(html).not.toContain("intent-tag");
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
