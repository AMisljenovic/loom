import { describe, expect, it } from "vitest";
import type { QuestionSpec } from "../../../src/shared/protocol";
import { draftToAnswers, emptyDraft, isQuestionDraftComplete, isQuestionFormComplete } from "./questionValidation";

const singleQ: QuestionSpec = {
    id: "audience",
    question: "Who is this for?",
    kind: "single",
    options: [{ id: "users", label: "Users" }, { id: "devs", label: "Devs" }],
};

const multipleQ: QuestionSpec = {
    id: "formats",
    question: "Which formats?",
    kind: "multiple",
    options: [{ id: "readme", label: "README" }, { id: "api", label: "API docs" }],
};

const questions: QuestionSpec[] = [singleQ, multipleQ];

describe("questionValidation", () => {
    it("requires all questions to be answered", () => {
        expect(isQuestionFormComplete(questions, {
            audience: { selectedOptionIds: ["users"], otherSelected: false, otherText: "" },
            formats: { selectedOptionIds: [], otherSelected: false, otherText: "" },
        })).toBe(false);
    });

    it("accepts Other only when text is present", () => {
        expect(isQuestionFormComplete(questions, {
            audience: { selectedOptionIds: [], otherSelected: true, otherText: "maintainers" },
            formats: { selectedOptionIds: [], otherSelected: true, otherText: " " },
        })).toBe(false);
        expect(isQuestionFormComplete(questions, {
            audience: { selectedOptionIds: [], otherSelected: true, otherText: "maintainers" },
            formats: { selectedOptionIds: [], otherSelected: true, otherText: "release notes" },
        })).toBe(true);
    });

    it("serializes selected options and trimmed Other text", () => {
        expect(draftToAnswers(questions, {
            audience: { selectedOptionIds: ["users"], otherSelected: false, otherText: "" },
            formats: { selectedOptionIds: ["readme"], otherSelected: true, otherText: " docs site " },
        })).toEqual([
            { questionId: "audience", selectedOptionIds: ["users"] },
            { questionId: "formats", selectedOptionIds: ["readme"], otherText: "docs site" },
        ]);
    });
});

describe("isQuestionDraftComplete", () => {
    it("single: true when exactly one option selected", () => {
        expect(isQuestionDraftComplete(singleQ, { selectedOptionIds: ["users"], otherSelected: false, otherText: "" })).toBe(true);
    });

    it("single: false when no option and no other", () => {
        expect(isQuestionDraftComplete(singleQ, { selectedOptionIds: [], otherSelected: false, otherText: "" })).toBe(false);
    });

    it("single: false when otherSelected but otherText is whitespace only", () => {
        expect(isQuestionDraftComplete(singleQ, { selectedOptionIds: [], otherSelected: true, otherText: "   " })).toBe(false);
    });

    it("single: true when otherSelected with non-empty text", () => {
        expect(isQuestionDraftComplete(singleQ, { selectedOptionIds: [], otherSelected: true, otherText: "managers" })).toBe(true);
    });

    it("single: false when both option selected and otherSelected (radio conflict)", () => {
        // otherSelected=true takes over the radio — the option should have been cleared
        // but even so: if otherSelected=true without text, the form is incomplete
        expect(isQuestionDraftComplete(singleQ, { selectedOptionIds: ["users"], otherSelected: true, otherText: "" })).toBe(false);
    });

    it("multiple: true with at least one option", () => {
        expect(isQuestionDraftComplete(multipleQ, { selectedOptionIds: ["readme"], otherSelected: false, otherText: "" })).toBe(true);
    });

    it("multiple: true with other text only", () => {
        expect(isQuestionDraftComplete(multipleQ, { selectedOptionIds: [], otherSelected: true, otherText: "changelog" })).toBe(true);
    });

    it("multiple: false when nothing selected", () => {
        expect(isQuestionDraftComplete(multipleQ, { selectedOptionIds: [], otherSelected: false, otherText: "" })).toBe(false);
    });

    it("returns false for undefined draft", () => {
        expect(isQuestionDraftComplete(singleQ, undefined)).toBe(false);
    });
});

describe("emptyDraft", () => {
    it("produces an empty entry for every question", () => {
        const draft = emptyDraft(questions);
        expect(Object.keys(draft)).toEqual(["audience", "formats"]);
        for (const entry of Object.values(draft)) {
            expect(entry).toEqual({ selectedOptionIds: [], otherSelected: false, otherText: "" });
        }
    });

    it("returns empty object for no questions", () => {
        expect(emptyDraft([])).toEqual({});
    });
});

describe("draftToAnswers", () => {
    it("omits otherText when otherSelected is false", () => {
        expect(draftToAnswers([singleQ], {
            audience: { selectedOptionIds: ["users"], otherSelected: false, otherText: "ignored" },
        })).toEqual([{ questionId: "audience", selectedOptionIds: ["users"] }]);
    });

    it("omits otherText when blank even if otherSelected", () => {
        expect(draftToAnswers([singleQ], {
            audience: { selectedOptionIds: [], otherSelected: true, otherText: "  " },
        })).toEqual([{ questionId: "audience", selectedOptionIds: [] }]);
    });

    it("falls back to empty draft for missing question entry", () => {
        const result = draftToAnswers([singleQ], {});
        expect(result).toEqual([{ questionId: "audience", selectedOptionIds: [] }]);
    });
});
