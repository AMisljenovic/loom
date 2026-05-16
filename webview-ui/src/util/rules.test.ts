import { describe, expect, it } from "vitest";
import {
    formatRule,
    inputString,
    isPathTool,
    makeCommandRule,
    makePathRule,
    makeToolRule,
    shortLabel,
} from "./rules";

describe("makeToolRule", () => {
    it("creates a tool-scope rule with the given tool name", () => {
        const rule = makeToolRule("read_file");
        expect(rule.tool).toBe("read_file");
        expect(rule.scope).toBe("tool");
        expect(typeof rule.id).toBe("string");
        expect(rule.id.length).toBeGreaterThan(0);
        expect(typeof rule.createdAt).toBe("number");
    });
});

describe("makeCommandRule", () => {
    it("creates an argPattern rule for run_command with an anchored regex", () => {
        const rule = makeCommandRule("npm test");
        expect(rule.tool).toBe("run_command");
        expect(rule.scope).toBe("argPattern");
        expect(rule.argKey).toBe("command");
        expect(rule.pattern).toBe("^npm test$");
    });

    it("escapes regex special characters in the command", () => {
        const rule = makeCommandRule("echo $HOME | grep .txt");
        expect(rule.pattern).toBe("^echo \\$HOME \\| grep \\.txt$");
    });
});

describe("makePathRule", () => {
    it("creates an argPattern rule for the given tool and path", () => {
        const rule = makePathRule("apply_diff", "src/App.tsx");
        expect(rule.tool).toBe("apply_diff");
        expect(rule.scope).toBe("argPattern");
        expect(rule.argKey).toBe("path");
        expect(rule.pattern).toBe("src/App.tsx");
    });
});

describe("formatRule", () => {
    it("returns 'Any invocation' for tool-scope rules", () => {
        expect(formatRule({ id: "1", tool: "read_file", scope: "tool", createdAt: 0 })).toBe("Any invocation");
    });

    it("returns command pattern description for command argPattern rules", () => {
        expect(formatRule({ id: "1", tool: "run_command", scope: "argPattern", argKey: "command", pattern: "^npm test$", createdAt: 0 }))
            .toBe("Command matches ^npm test$");
    });

    it("returns path pattern description for path argPattern rules", () => {
        expect(formatRule({ id: "1", tool: "apply_diff", scope: "argPattern", argKey: "path", pattern: "src/App.tsx", createdAt: 0 }))
            .toBe("Path matches src/App.tsx");
    });
});

describe("inputString", () => {
    it("extracts a string value from an object by key", () => {
        expect(inputString({ command: "npm test" }, "command")).toBe("npm test");
        expect(inputString({ path: "src/a.ts" }, "path")).toBe("src/a.ts");
    });

    it("returns undefined when the key is missing", () => {
        expect(inputString({ other: "value" }, "command")).toBeUndefined();
    });

    it("returns undefined when the value is not a string", () => {
        expect(inputString({ command: 42 }, "command")).toBeUndefined();
    });

    it("returns undefined for null, non-object, or missing input", () => {
        expect(inputString(null, "command")).toBeUndefined();
        expect(inputString(undefined, "path")).toBeUndefined();
        expect(inputString("string", "command")).toBeUndefined();
    });
});

describe("isPathTool", () => {
    it("returns true for known path tools", () => {
        expect(isPathTool("apply_diff")).toBe(true);
        expect(isPathTool("read_file")).toBe(true);
        expect(isPathTool("list_dir")).toBe(true);
        expect(isPathTool("search")).toBe(true);
    });

    it("returns false for other tools", () => {
        expect(isPathTool("run_command")).toBe(false);
        expect(isPathTool("ask_questions")).toBe(false);
        expect(isPathTool("")).toBe(false);
    });
});

describe("shortLabel", () => {
    it("returns the value unchanged when 32 chars or fewer", () => {
        expect(shortLabel("abc")).toBe("abc");
        expect(shortLabel("a".repeat(32))).toBe("a".repeat(32));
    });

    it("truncates values longer than 32 chars with ellipsis", () => {
        const long = "a".repeat(40);
        const result = shortLabel(long);
        expect(result).toBe(`${"a".repeat(29)}...`);
        expect(result.length).toBe(32);
    });
});
