import type { AskQuestionsInput, QuestionAnswer, QuestionSpec } from "./protocol";

export function normalizeAskQuestionsInput(input: unknown): AskQuestionsInput {
  if (!input || typeof input !== "object") {
    throw new Error("ask_questions requires an object input");
  }
  const raw = input as { title?: unknown; questions?: unknown };
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) {
    throw new Error("ask_questions requires at least one question");
  }
  const questions = raw.questions.map((q, qIndex) => normalizeQuestion(q, qIndex));
  return {
    title: typeof raw.title === "string" ? raw.title.trim() || undefined : undefined,
    questions,
  };
}

export function normalizeQuestionAnswers(
  request: AskQuestionsInput,
  answers: unknown,
): QuestionAnswer[] {
  if (!Array.isArray(answers)) {
    throw new Error("answers must be an array");
  }
  const byQuestion = new Map(request.questions.map((q) => [q.id, q]));
  const byAnswer = new Map(answers.map((a) => {
    if (!a || typeof a !== "object") {
      throw new Error("each answer must be an object");
    }
    const answer = a as QuestionAnswer;
    return [answer.questionId, answer];
  }));
  return request.questions.map((question) => {
    const raw = byAnswer.get(question.id);
    if (!raw) {
      throw new Error(`missing answer for ${question.id}`);
    }
    const validOptions = new Set(question.options.map((o) => o.id));
    let selectedOptionIds = Array.isArray(raw.selectedOptionIds)
      ? raw.selectedOptionIds.filter((id) => validOptions.has(id))
      : [];
    if (question.kind === "single") {
      selectedOptionIds = selectedOptionIds.slice(0, 1);
    }
    const otherText = typeof raw.otherText === "string" ? raw.otherText.trim() : "";
    if (selectedOptionIds.length === 0 && !otherText) {
      throw new Error(`answer for ${question.id} is empty`);
    }
    if (!byQuestion.has(raw.questionId)) {
      throw new Error(`unknown question ${raw.questionId}`);
    }
    return {
      questionId: question.id,
      selectedOptionIds,
      ...(otherText ? { otherText } : {}),
    };
  });
}

export function formatQuestionToolResult(
  request: AskQuestionsInput,
  answers: QuestionAnswer[],
): string {
  const questions = new Map(request.questions.map((q) => [q.id, q]));
  return JSON.stringify({
    title: request.title,
    answers: answers.map((answer) => {
      const question = questions.get(answer.questionId);
      const labels = answer.selectedOptionIds
        .map((id) => question?.options.find((o) => o.id === id)?.label)
        .filter((label): label is string => Boolean(label));
      return {
        questionId: answer.questionId,
        question: question?.question,
        selectedOptionIds: answer.selectedOptionIds,
        selectedLabels: labels,
        otherText: answer.otherText,
      };
    }),
  });
}

function normalizeQuestion(input: unknown, index: number): QuestionSpec {
  if (!input || typeof input !== "object") {
    throw new Error(`question ${index + 1} must be an object`);
  }
  const raw = input as {
    id?: unknown;
    question?: unknown;
    kind?: unknown;
    options?: unknown;
  };
  const id = cleanId(raw.id, `q${index + 1}`);
  const question = typeof raw.question === "string" ? raw.question.trim() : "";
  if (!question) {
    throw new Error(`question ${id} is missing text`);
  }
  const kind = raw.kind === "multiple" ? "multiple" : raw.kind === "single" ? "single" : undefined;
  if (!kind) {
    throw new Error(`question ${id} must have kind single or multiple`);
  }
  if (!Array.isArray(raw.options) || raw.options.length === 0) {
    throw new Error(`question ${id} requires options`);
  }
  const seen = new Set<string>();
  const options = raw.options.map((option, optionIndex) => {
    if (!option || typeof option !== "object") {
      throw new Error(`option ${optionIndex + 1} for ${id} must be an object`);
    }
    const opt = option as { id?: unknown; label?: unknown; description?: unknown };
    let optId = cleanId(opt.id, `o${optionIndex + 1}`);
    while (seen.has(optId)) {
      optId = `${optId}-${optionIndex + 1}`;
    }
    seen.add(optId);
    const label = typeof opt.label === "string" ? opt.label.trim() : "";
    if (!label) {
      throw new Error(`option ${optionIndex + 1} for ${id} is missing a label`);
    }
    const description = typeof opt.description === "string" ? opt.description.trim() : "";
    return {
      id: optId,
      label,
      ...(description ? { description } : {}),
    };
  });
  return { id, question, kind, options };
}

function cleanId(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const cleaned = value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}
