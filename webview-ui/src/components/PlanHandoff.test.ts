import { describe, expect, it } from "vitest";
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
});
