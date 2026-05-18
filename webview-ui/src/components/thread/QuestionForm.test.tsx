import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Msg, QuestionSpec } from "../../../../src/shared/protocol";
import { QuestionForm } from "./QuestionForm";

function questionMsg(questions: QuestionSpec[]): Extract<Msg, { role: "question" }> {
    return {
        role: "question",
        callId: "call-1",
        title: "Choose carefully",
        questions,
        status: "pending",
    };
}

function singleChoice(id: string, label: string): QuestionSpec {
    return {
        id,
        question: `Question ${id}?`,
        kind: "single",
        options: [
            { id: `${id}-yes`, label: "Yes" },
            { id: `${id}-no`, label: "No" },
        ],
    };
}

describe("QuestionForm", () => {
    it("renders a tablist with one tab per question when there are multiple questions", () => {
        const html = renderToStaticMarkup(
            <QuestionForm
                msg={questionMsg([singleChoice("a", "first"), singleChoice("b", "second"), singleChoice("c", "third")])}
            />,
        );

        expect(html).toContain('role="tablist"');
        expect(html).toContain(">Q1<");
        expect(html).toContain(">Q2<");
        expect(html).toContain(">Q3<");
    });

    it("only renders the active tab's question fieldset", () => {
        const html = renderToStaticMarkup(
            <QuestionForm
                msg={questionMsg([singleChoice("a", "first"), singleChoice("b", "second")])}
            />,
        );

        expect(html).toContain("Question a?");
        expect(html).not.toContain("Question b?");
    });

    it("disables the submit button when answers are incomplete", () => {
        const html = renderToStaticMarkup(
            <QuestionForm
                msg={questionMsg([singleChoice("a", "first"), singleChoice("b", "second")])}
            />,
        );

        expect(html).toMatch(/<button[^>]*class="btn btn-primary"[^>]*disabled[^>]*>Submit answers<\/button>/);
    });

    it("hides the tab strip for a single-question batch", () => {
        const html = renderToStaticMarkup(
            <QuestionForm msg={questionMsg([singleChoice("a", "only")])} />,
        );

        expect(html).not.toContain('role="tablist"');
        expect(html).toContain("Question a?");
    });
});
