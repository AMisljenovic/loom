import { describe, expect, it } from "vitest";
import { recoverableApplyDiffError } from "./applyDiffRecovery";

describe("recoverableApplyDiffError", () => {
  it("tells the model to read and replace the full file after an exact-match miss", () => {
    const message = recoverableApplyDiffError("radio_player/app_controller.py", 1, "oldText not found");

    expect(message).toContain("edit 1: oldText not found");
    expect(message).toContain("call read_file for the same path");
    expect(message).toContain("oldText set to the full current file contents");
    expect(message).toContain("newText set to the full desired file contents");
    expect(message).toContain("radio_player/app_controller.py");
  });
});
