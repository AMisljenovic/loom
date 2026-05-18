import { useMemo, useState } from "react";
import { parseProposedPlan, type PlanStep } from "../../../src/shared/plans";
import type { TodoItem } from "../../../src/shared/protocol";
import * as Ico from "../brand/icons";

interface PlanHandoffProps {
    markdown: string;
    onImplement: (prompt: string, todos?: TodoItem[]) => void;
    onDismiss: () => void;
}

export function PlanHandoff({ markdown, onImplement, onDismiss }: PlanHandoffProps) {
    const parsed = useMemo(() => parseProposedPlan(markdown), [markdown]);
    const [selected, setSelected] = useState<Set<number>>(() => new Set(parsed.steps.map((s) => s.index)));

    const toggle = (i: number) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i); else next.add(i);
            return next;
        });
    };

    const implementAll = () => {
        onImplement("Implement the plan above.", planStepsToTodos(parsed.steps));
    };

    const implementSelected = () => {
        const picks = parsed.steps.filter((s) => selected.has(s.index));
        if (picks.length === 0 || picks.length === parsed.steps.length) {
            implementAll();
            return;
        }
        const prompt = buildStepsPrompt(picks);
        onImplement(prompt, planStepsToTodos(picks));
    };

    if (parsed.steps.length === 0) {
        return (
            <div className="plan-handoff">
                <span className="plan-handoff-label">Plan ready.</span>
                <button className="btn btn-primary" onClick={implementAll}>Implement plan</button>
                <button className="btn btn-sm" onClick={onDismiss}>Dismiss</button>
            </div>
        );
    }

    const allSelected = selected.size === parsed.steps.length;
    const noneSelected = selected.size === 0;

    return (
        <div className="plan-handoff plan-handoff-structured">
            <div className="plan-handoff-head">
                <Ico.Check size={12} />
                <span className="plan-handoff-label">Plan ready — {parsed.steps.length} step{parsed.steps.length === 1 ? "" : "s"}</span>
                <button
                    className="plan-toggle-all"
                    onClick={() => setSelected(allSelected ? new Set() : new Set(parsed.steps.map((s) => s.index)))}
                >
                    {allSelected ? "Clear all" : "Select all"}
                </button>
                <button className="btn btn-sm" onClick={onDismiss}>Dismiss</button>
            </div>
            <ol className="plan-step-list">
                {parsed.steps.map((step) => (
                    <li key={step.index} className={`plan-step${selected.has(step.index) ? " selected" : ""}`}>
                        <label className="plan-step-label">
                            <input
                                type="checkbox"
                                checked={selected.has(step.index)}
                                onChange={() => toggle(step.index)}
                            />
                            <span className="plan-step-title">{step.title}</span>
                        </label>
                        <div className="plan-step-actions">
                            <button
                                className="btn btn-sm"
                                onClick={() => onImplement(buildStepsPrompt([step]), planStepsToTodos([step]))}
                            >
                                Implement
                            </button>
                        </div>
                    </li>
                ))}
            </ol>
            <div className="plan-handoff-foot">
                <button className="btn btn-primary" disabled={noneSelected} onClick={implementSelected}>
                    Implement {allSelected ? "all" : "selected"}
                </button>
            </div>
        </div>
    );
}

export function planStepsToTodos(steps: PlanStep[]): TodoItem[] {
    return steps.map((step) => ({
        id: `plan-step-${step.index + 1}`,
        text: step.title,
        status: "pending",
    }));
}

function buildStepsPrompt(steps: PlanStep[]): string {
    if (steps.length === 1) {
        const s = steps[0];
        return `Implement step ${s.index + 1} from the plan above: ${s.title}${s.body ? `\n\n${s.body}` : ""}`;
    }
    const list = steps.map((s) => `${s.index + 1}. ${s.title}${s.body ? `\n\n${s.body}` : ""}`).join("\n\n");
    return `Implement the following steps from the plan above:\n\n${list}`;
}
