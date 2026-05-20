import { describe, expect, it } from "vitest";
import { parseProposedPlan } from "../../../src/shared/plans";
import { planStepsToTodos } from "./PlanHandoff";

describe("planStepsToTodos", () => {
    it("seeds pending todos from selected plan steps", () => {
        expect(planStepsToTodos([
            { index: 0, title: "Build settings UI", body: "" },
            { index: 2, title: "Run tests", body: "npm run test:ts" },
        ])).toEqual([
            { id: "plan-step-1", text: "Build settings UI", status: "pending" },
            { id: "plan-step-3", text: "Run tests", status: "pending" },
        ]);
    });

    it("uses parser-cleaned labels for seeded plan todos", () => {
        const parsed = parseProposedPlan(`## Implementation Changes
- **Update \`src/panel/ChatPanel.ts\` wiring.**
- **Run \`npm run test:ts\`.**`);

        expect(planStepsToTodos(parsed.steps)).toEqual([
            { id: "plan-step-1", text: "Update src/panel/ChatPanel.ts wiring.", status: "pending" },
            { id: "plan-step-2", text: "Run npm run test:ts.", status: "pending" },
        ]);
    });

    it("combines grouped test headings with their first nested detail", () => {
        const parsed = parseProposedPlan(`## Tests
- **State store tests**
  - Add tests in a new or existing cache test module to verify behavior.
- **API client tests**
  - Extend \`tests/test_api_client.py\` with coverage.`);

        expect(planStepsToTodos(parsed.steps)).toEqual([
            {
                id: "plan-step-1",
                text: "State store tests: Add tests in a new or existing cache test module to verify behavior.",
                status: "pending",
            },
            {
                id: "plan-step-2",
                text: "API client tests: Extend tests/test_api_client.py with coverage.",
                status: "pending",
            },
        ]);
    });
});
