import { describe, expect, it } from "vitest";
import { recoverableApplyDiffError } from "./applyDiffRecovery";

describe("recoverableApplyDiffError", () => {
  it("steers the model to a range edit after a not-found match", () => {
    const message = recoverableApplyDiffError("radio_player/app_controller.py", 1, "oldText not found");

    expect(message).toContain("edit 1: oldText not found");
    expect(message).toContain("range edit {startLine, endLine, newText}");
    expect(message).toContain("Do not re-emit the whole file");
    expect(message).toContain("radio_player/app_controller.py");
  });

  it("lists every matched line on an ambiguous match", () => {
    const message = recoverableApplyDiffError("src/app.ts", 2, "oldText found 3 times", [12, 47, 88]);

    expect(message).toContain("edit 2: oldText found 3 times");
    expect(message).toContain("Matches at lines: 12, 47, 88.");
    expect(message).toContain("range edit");
  });
});
