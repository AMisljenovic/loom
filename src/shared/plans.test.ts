import { describe, expect, it } from "vitest";
import { extractProposedPlan, parseProposedPlan } from "./plans";

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

describe("parseProposedPlan", () => {
  it("extracts clean todos from implementation and test lists", () => {
    const parsed = parseProposedPlan(`# Modernize GUI

## Summary
- This is context, not a todo.

## Key Changes
- **Switch interactive widgets to bootstrap-aware styling instead of raw ttk style names.**
- **Shrink \`gui_parts/theme.py\` so it complements bootstrap instead of overriding it.**
- **Unify the GUI style flow around one theme source.**

## Important interface or data-flow changes
- Do not show this as an implementation todo.

## Tests
- **Add a GUI dependency regression test** in \`tests/test_gui_exports.py\`.
- **Keep existing parser/export tests green**.

## Assumptions
- Windows visual verification remains manual.
`);

    expect(parsed.steps.map((s) => s.title)).toEqual([
      "Switch interactive widgets to bootstrap-aware styling instead of raw ttk style names.",
      "Shrink gui_parts/theme.py so it complements bootstrap instead of overriding it.",
      "Unify the GUI style flow around one theme source.",
      "Add a GUI dependency regression test in tests/test_gui_exports.py.",
      "Keep existing parser/export tests green.",
    ]);
  });

  it("supports top-level numbered implementation plans without treating headings as steps", () => {
    const parsed = parseProposedPlan(`# Plan

1. **Inspect current UI code.**
2. Update the renderer.
3. Run \`npm run test:ts\`.
`);

    expect(parsed.steps.map((s) => s.title)).toEqual([
      "Inspect current UI code.",
      "Update the renderer.",
      "Run npm run test:ts.",
    ]);
  });

  it("keeps nested bullets as body instead of separate steps", () => {
    const parsed = parseProposedPlan(`## Tests
- **State store tests**
  - Add tests in a new or existing cache test module to verify behavior.
- **API client tests**
  - Extend \`tests/test_api_client.py\` with coverage.
`);

    expect(parsed.steps.map((s) => s.title)).toEqual([
      "State store tests",
      "API client tests",
    ]);
    expect(parsed.steps[0].body).toContain("Add tests in a new or existing cache test module");
    expect(parsed.steps[1].body).toContain("tests/test_api_client.py");
  });
});
