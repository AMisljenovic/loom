import { describe, expect, it } from "vitest";
import { toolLabel } from "./activity";

describe("toolLabel", () => {
    it("uses a generic shell label for automatic command shell selection", () => {
        expect(toolLabel("run_command", { command: "npm test" })).toBe("Shell");
        expect(toolLabel("run_command_background", { command: "npm run watch", shell: "auto" })).toBe("Shell");
    });

    it("uses explicit command shell labels when requested", () => {
        expect(toolLabel("run_command", { command: "npm test", shell: "powershell" })).toBe("PowerShell");
        expect(toolLabel("run_command", { command: "npm test", shell: "cmd" })).toBe("Command");
        expect(toolLabel("run_command", { command: "npm test", shell: "bash" })).toBe("Bash");
        expect(toolLabel("run_command", { command: "npm test", shell: "sh" })).toBe("Sh");
    });
});
