import type { QuestionAnswer, QuestionSpec } from "../../../src/shared/protocol";

export interface DraftQuestionAnswer {
    selectedOptionIds: string[];
    otherSelected: boolean;
    otherText: string;
}

export type DraftAnswers = Record<string, DraftQuestionAnswer>;

export function emptyDraft(questions: QuestionSpec[]): DraftAnswers {
    const out: DraftAnswers = {};
    for (const q of questions) {
        out[q.id] = { selectedOptionIds: [], otherSelected: false, otherText: "" };
    }
    return out;
}

export function isQuestionDraftComplete(question: QuestionSpec, draft: DraftQuestionAnswer | undefined): boolean {
    if (!draft) return false;
    const hasOption = draft.selectedOptionIds.length > 0;
    const hasOther = draft.otherSelected && draft.otherText.trim().length > 0;
    if (question.kind === "single") {
        return (hasOption && draft.selectedOptionIds.length === 1 && !draft.otherSelected) || hasOther;
    }
    return hasOption || hasOther;
}

export function isQuestionFormComplete(questions: QuestionSpec[], draft: DraftAnswers): boolean {
    return questions.every((q) => isQuestionDraftComplete(q, draft[q.id]));
}

export function draftToAnswers(questions: QuestionSpec[], draft: DraftAnswers): QuestionAnswer[] {
    return questions.map((q) => {
        const answer = draft[q.id] ?? { selectedOptionIds: [], otherSelected: false, otherText: "" };
        return {
            questionId: q.id,
            selectedOptionIds: answer.selectedOptionIds,
            ...(answer.otherSelected && answer.otherText.trim() ? { otherText: answer.otherText.trim() } : {}),
        };
    });
}
