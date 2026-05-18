import { useEffect, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import type { Msg, QuestionSpec } from "../../../../src/shared/protocol";
import * as Ico from "../../brand/icons";
import { questionActivityLabel, selectedAnswerLabels } from "../../util/activity";
import { post } from "../../vscode";
import {
    draftToAnswers,
    emptyDraft,
    isQuestionDraftComplete,
    isQuestionFormComplete,
    type DraftAnswers,
} from "../../util/questionValidation";

interface QuestionFormProps {
    msg: Extract<Msg, { role: "question" }>;
}

export function QuestionForm({ msg }: QuestionFormProps) {
    const [draft, setDraft] = useState<DraftAnswers>(() => emptyDraft(msg.questions));
    const [expanded, setExpanded] = useState(msg.status === "pending");
    const [activeTab, setActiveTab] = useState(0);
    const complete = isQuestionFormComplete(msg.questions, draft);
    const answered = msg.status === "answered";
    const cancelled = msg.status === "cancelled";
    const activity = questionActivityLabel(msg);
    const multi = msg.questions.length > 1;
    const safeTab = Math.min(activeTab, Math.max(msg.questions.length - 1, 0));
    const activeQuestion = msg.questions[safeTab];

    useEffect(() => {
        if (msg.status === "answered") {
            setExpanded(false);
        }
    }, [msg.status]);

    const submit = () => {
        if (!complete || answered) return;
        post({ type: "answerQuestions", callId: msg.callId, answers: draftToAnswers(msg.questions, draft) });
    };

    const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
        if (e.key === "ArrowRight") {
            e.preventDefault();
            setActiveTab(Math.min(idx + 1, msg.questions.length - 1));
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            setActiveTab(Math.max(idx - 1, 0));
        }
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
                    {multi && (
                        <div className="question-tabs" role="tablist" aria-label="Questions">
                            {msg.questions.map((q, idx) => {
                                const done = isQuestionDraftComplete(q, draft[q.id]);
                                const isActive = idx === safeTab;
                                const panelId = `question-${msg.callId}-panel-${q.id}`;
                                return (
                                    <button
                                        key={q.id}
                                        type="button"
                                        role="tab"
                                        id={`question-${msg.callId}-tab-${q.id}`}
                                        aria-controls={panelId}
                                        aria-selected={isActive}
                                        tabIndex={isActive ? 0 : -1}
                                        className={`question-tab${isActive ? " active" : ""}${done ? " done" : ""}`}
                                        onClick={() => setActiveTab(idx)}
                                        onKeyDown={(e) => onTabKey(e, idx)}
                                    >
                                        <span className="question-tab-num">Q{idx + 1}</span>
                                        <span className="question-tab-dot" aria-hidden="true">
                                            {done ? <Ico.Check size={9} /> : null}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    {activeQuestion && (
                        <div
                            className="question-list"
                            role={multi ? "tabpanel" : undefined}
                            id={multi ? `question-${msg.callId}-panel-${activeQuestion.id}` : undefined}
                            aria-labelledby={multi ? `question-${msg.callId}-tab-${activeQuestion.id}` : undefined}
                        >
                            <QuestionField
                                key={activeQuestion.id}
                                question={activeQuestion}
                                draft={draft}
                                setDraft={setDraft}
                            />
                        </div>
                    )}
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
