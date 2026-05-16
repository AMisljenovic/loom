import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { Msg, QuestionSpec } from "../../../../src/shared/protocol";
import * as Ico from "../../brand/icons";
import { questionActivityLabel, selectedAnswerLabels } from "../../util/activity";
import { post } from "../../vscode";
import {
    draftToAnswers,
    emptyDraft,
    isQuestionFormComplete,
    type DraftAnswers,
} from "../../util/questionValidation";

interface QuestionFormProps {
    msg: Extract<Msg, { role: "question" }>;
}

export function QuestionForm({ msg }: QuestionFormProps) {
    const [draft, setDraft] = useState<DraftAnswers>(() => emptyDraft(msg.questions));
    const [expanded, setExpanded] = useState(msg.status === "pending");
    const complete = isQuestionFormComplete(msg.questions, draft);
    const answered = msg.status === "answered";
    const cancelled = msg.status === "cancelled";
    const activity = questionActivityLabel(msg);

    useEffect(() => {
        if (msg.status === "answered") {
            setExpanded(false);
        }
    }, [msg.status]);

    const submit = () => {
        if (!complete || answered) return;
        post({ type: "answerQuestions", callId: msg.callId, answers: draftToAnswers(msg.questions, draft) });
    };

    return (
        <div className={`question-card${answered ? " answered" : ""}${cancelled ? " cancelled" : ""}${expanded ? " open" : ""}`}>
            <button className="question-head" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
                <span className="question-title">{activity}</span>
                <span className="question-status">{answered ? "answered" : cancelled ? "expired" : "waiting for you"}</span>
                <span className="tc-chev">{expanded ? <Ico.ChevDn size={9} /> : <Ico.Chev size={9} />}</span>
            </button>
            {cancelled || !expanded ? null : answered ? (
                <div className="question-answers">
                    {msg.questions.map((q) => {
                        const selected = selectedAnswerLabels(q, msg.answers);
                        return (
                            <div className="question-answer" key={q.id}>
                                <div className="question-text">{q.question}</div>
                                <div className="question-selected">{selected.join(", ") || "No answer"}</div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <>
                    <div className="question-list">
                        {msg.questions.map((q) => (
                            <QuestionField
                                key={q.id}
                                question={q}
                                draft={draft}
                                setDraft={setDraft}
                            />
                        ))}
                    </div>
                    <div className="question-actions">
                        <button className="btn btn-primary" disabled={!complete} onClick={submit}>
                            Submit answers
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

interface QuestionFieldProps {
    question: QuestionSpec;
    draft: DraftAnswers;
    setDraft: Dispatch<SetStateAction<DraftAnswers>>;
}

function QuestionField({ question, draft, setDraft }: QuestionFieldProps) {
    const current = draft[question.id] ?? { selectedOptionIds: [], otherSelected: false, otherText: "" };
    const inputType = question.kind === "multiple" ? "checkbox" : "radio";
    const groupName = `question-${question.id}`;

    const setOption = (id: string, checked: boolean) => {
        setDraft((prev) => {
            const prevAnswer = prev[question.id] ?? current;
            if (question.kind === "single") {
                return {
                    ...prev,
                    [question.id]: { ...prevAnswer, selectedOptionIds: [id], otherSelected: false },
                };
            }
            const selected = new Set(prevAnswer.selectedOptionIds);
            if (checked) selected.add(id);
            else selected.delete(id);
            return {
                ...prev,
                [question.id]: { ...prevAnswer, selectedOptionIds: Array.from(selected) },
            };
        });
    };

    const setOtherSelected = (checked: boolean) => {
        setDraft((prev) => {
            const prevAnswer = prev[question.id] ?? current;
            return {
                ...prev,
                [question.id]: {
                    ...prevAnswer,
                    selectedOptionIds: question.kind === "single" && checked ? [] : prevAnswer.selectedOptionIds,
                    otherSelected: checked,
                },
            };
        });
    };

    const setOtherText = (value: string) => {
        setDraft((prev) => {
            const prevAnswer = prev[question.id] ?? current;
            return {
                ...prev,
                [question.id]: {
                    ...prevAnswer,
                    selectedOptionIds: question.kind === "single" ? [] : prevAnswer.selectedOptionIds,
                    otherSelected: true,
                    otherText: value,
                },
            };
        });
    };

    return (
        <fieldset className="question-field">
            <legend>{question.question}</legend>
            <div className="question-options">
                {question.options.map((option) => {
                    const checked = current.selectedOptionIds.includes(option.id);
                    return (
                        <label className="question-option" key={option.id}>
                            <input
                                type={inputType}
                                name={groupName}
                                checked={checked}
                                onChange={(e) => setOption(option.id, e.currentTarget.checked)}
                            />
                            <span>
                                <strong>{option.label}</strong>
                                {option.description && <small>{option.description}</small>}
                            </span>
                        </label>
                    );
                })}
                <label className="question-option other">
                    <input
                        type={inputType}
                        name={groupName}
                        checked={current.otherSelected}
                        onChange={(e) => setOtherSelected(e.currentTarget.checked)}
                    />
                    <span>
                        <strong>Other</strong>
                        <input
                            className="question-other-input"
                            value={current.otherText}
                            onChange={(e) => setOtherText(e.currentTarget.value)}
                            onFocus={() => setOtherSelected(true)}
                            placeholder="Type your answer"
                        />
                    </span>
                </label>
            </div>
        </fieldset>
    );
}
