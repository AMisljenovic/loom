import { describe, expect, it } from "vitest";
import { formatQuestionToolResult, normalizeAskQuestionsInput, normalizeQuestionAnswers } from "./questions";

const request = normalizeAskQuestionsInput({
  title: "Plan decisions",
  questions: [
    {
      id: "audience",
      question: "Who is this for?",
      kind: "single",
      options: [
        { id: "users", label: "End users" },
        { id: "devs", label: "Developers" },
      ],
    },
    {
      id: "formats",
      question: "Which outputs matter?",
      kind: "multiple",
      options: [
        { id: "readme", label: "README" },
        { id: "api", label: "API docs" },
      ],
    },
  ],
});

describe("question helpers", () => {
  it("normalizes selected options and trims other text", () => {
    expect(normalizeQuestionAnswers(request, [
      { questionId: "audience", selectedOptionIds: ["devs", "users"] },
      { questionId: "formats", selectedOptionIds: ["api", "unknown"], otherText: "  migration notes " },
    ])).toEqual([
      { questionId: "audience", selectedOptionIds: ["devs"] },
      { questionId: "formats", selectedOptionIds: ["api"], otherText: "migration notes" },
    ]);
  });

  it("requires every answer to choose an option or other text", () => {
    expect(() => normalizeQuestionAnswers(request, [
      { questionId: "audience", selectedOptionIds: [] },
      { questionId: "formats", selectedOptionIds: ["api"] },
    ])).toThrow("answer for audience is empty");
  });

  it("throws on missing answer", () => {
    expect(() => normalizeQuestionAnswers(request, [
      { questionId: "audience", selectedOptionIds: ["users"] },
    ])).toThrow("missing answer for formats");
  });

  it("treats whitespace-only other text as empty", () => {
    expect(() => normalizeQuestionAnswers(request, [
      { questionId: "audience", selectedOptionIds: [], otherText: "  " },
      { questionId: "formats", selectedOptionIds: ["api"] },
    ])).toThrow("answer for audience is empty");
  });

  it("allows other text with no option IDs on single-kind", () => {
    expect(normalizeQuestionAnswers(request, [
      { questionId: "audience", selectedOptionIds: [], otherText: "managers" },
      { questionId: "formats", selectedOptionIds: ["readme"] },
    ])).toEqual([
      { questionId: "audience", selectedOptionIds: [], otherText: "managers" },
      { questionId: "formats", selectedOptionIds: ["readme"] },
    ]);
  });

  it("strips all invalid option IDs on multiple-kind and falls back to other text", () => {
    expect(normalizeQuestionAnswers(request, [
      { questionId: "audience", selectedOptionIds: ["users"] },
      { questionId: "formats", selectedOptionIds: ["nonexistent"], otherText: "blog post" },
    ])).toEqual([
      { questionId: "audience", selectedOptionIds: ["users"] },
      { questionId: "formats", selectedOptionIds: [], otherText: "blog post" },
    ]);
  });

  it("formats a model-readable tool result with labels", () => {
    expect(JSON.parse(formatQuestionToolResult(request, [
      { questionId: "audience", selectedOptionIds: ["users"] },
      { questionId: "formats", selectedOptionIds: ["readme"], otherText: "release notes" },
    ]))).toMatchObject({
      title: "Plan decisions",
      answers: [
        { questionId: "audience", selectedLabels: ["End users"] },
        { questionId: "formats", selectedLabels: ["README"], otherText: "release notes" },
      ],
    });
  });
});

describe("normalizeAskQuestionsInput", () => {
  it("rejects non-object input", () => {
    expect(() => normalizeAskQuestionsInput(null)).toThrow();
    expect(() => normalizeAskQuestionsInput("string")).toThrow();
  });

  it("rejects empty questions array", () => {
    expect(() => normalizeAskQuestionsInput({ questions: [] })).toThrow();
  });

  it("strips title when blank", () => {
    const result = normalizeAskQuestionsInput({
      title: "  ",
      questions: [{ id: "q1", question: "Do it?", kind: "single", options: [{ id: "yes", label: "Yes" }] }],
    });
    expect(result.title).toBeUndefined();
  });

  it("sanitizes question IDs with special characters", () => {
    const result = normalizeAskQuestionsInput({
      questions: [{ id: "my question!", question: "Which?", kind: "single", options: [{ id: "a", label: "A" }] }],
    });
    expect(result.questions[0].id).toBe("my-question");
  });

  it("assigns fallback ID when id is missing", () => {
    const result = normalizeAskQuestionsInput({
      questions: [{ question: "Which?", kind: "multiple", options: [{ id: "a", label: "A" }] }],
    });
    expect(result.questions[0].id).toBe("q1");
  });

  it("rejects question with unknown kind", () => {
    expect(() => normalizeAskQuestionsInput({
      questions: [{ id: "q1", question: "Which?", kind: "other", options: [{ id: "a", label: "A" }] }],
    })).toThrow();
  });

  it("rejects question with no options", () => {
    expect(() => normalizeAskQuestionsInput({
      questions: [{ id: "q1", question: "Which?", kind: "single", options: [] }],
    })).toThrow();
  });

  it("deduplicates option IDs", () => {
    const result = normalizeAskQuestionsInput({
      questions: [{
        id: "q1",
        question: "Which?",
        kind: "multiple",
        options: [
          { id: "a", label: "A" },
          { id: "a", label: "A2" },
        ],
      }],
    });
    const ids = result.questions[0].options.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

