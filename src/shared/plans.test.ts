import { describe, expect, it } from "vitest";
import { extractProposedPlan } from "./plans";

describe("extractProposedPlan", () => {
  it("extracts trimmed markdown from a proposed_plan block", () => {
    expect(extractProposedPlan("before\n<proposed_plan>\n# Plan\n\n- Do it\n</proposed_plan>\nafter")).toEqual({
      markdown: "# Plan\n\n- Do it",
    });
  });

  it("ignores missing or empty plan blocks", () => {
    expect(extractProposedPlan("# Plan")).toBeUndefined();
    expect(extractProposedPlan("<proposed_plan>\n\n</proposed_plan>")).toBeUndefined();
  });
});
