import { describe, expect, it } from "vitest";
import type { Msg, QuestionSpec } from "../../../src/shared/protocol";
import { questionActivityLabel, selectedAnswerLabels, toolActivityLabel } from "./activity";

describe("activity helpers", () => {
    it("formats terse tool activity labels", () => {
        const msg: Extract<Msg, { role: "tool" }> = {
            role: "tool",
            name: "read_file",
            status: "done",
            callId: "c1",
            input: { path: "src/panel/ChatPanel.ts" },
        };

        expect(toolActivityLabel(msg)).toBe("Read src/panel/ChatPanel.ts");
    });

    it("formats pending write and command approvals as actions", () => {
        expect(toolActivityLabel({
            role: "tool",
            name: "apply_diff",
            status: "pending",
            callId: "c1",
            input: { path: "src/App.tsx" },
        })).toBe("Approve changes src/App.tsx");

        expect(toolActivityLabel({
            role: "tool",
            name: "run_command",
            status: "pending",
            callId: "c2",
            input: { command: "npm run build" },
        })).toBe("Approve command npm run build");
    });

    it("formats answered question labels and selected answers", () => {
        const question: QuestionSpec = {
            id: "scope",
            question: "What scope?",
            kind: "single",
            options: [{ id: "light", label: "Light improvement" }],
        };
        const msg: Extract<Msg, { role: "question" }> = {
            role: "question",
            callId: "q1",
            title: "Light improvement scope",
            questions: [question],
            status: "answered",
            answers: [{ questionId: "scope", selectedOptionIds: ["light"], otherText: "docs too" }],
        };

        expect(questionActivityLabel(msg)).toBe("Answered Light improvement scope");
        expect(selectedAnswerLabels(question, msg.answers)).toEqual(["Light improvement", "docs too"]);
    });
});
