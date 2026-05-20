import { describe, expect, it } from "vitest";
import { formatToolDisplayOutput, parseRipgrep, parseUnifiedDiff } from "./parseToolOutput";

// ---------------------------------------------------------------------------
// parseRipgrep
// ---------------------------------------------------------------------------

const RIPGREP_OUTPUT = [
    "src/App.tsx:10:const x = 1;",
    "src/App.tsx:20:const y = 2;",
    "webview/main.tsx:5:import React from 'react';",
].join("\n");

describe("parseRipgrep", () => {
    it("returns null for empty output", () => {
        expect(parseRipgrep("")).toBeNull();
        expect(parseRipgrep("   \n  ")).toBeNull();
    });

    it("parses multi-file ripgrep output and groups by file", () => {
        const result = parseRipgrep(RIPGREP_OUTPUT);
        expect(result).not.toBeNull();
        expect(result!).toHaveLength(2);

        const appFile = result!.find((r) => r.file === "src/App.tsx");
        expect(appFile).toBeDefined();
        expect(appFile!.matches).toHaveLength(2);
        expect(appFile!.matches[0]).toEqual({ file: "src/App.tsx", line: 10, text: "const x = 1;" });
        expect(appFile!.matches[1]).toEqual({ file: "src/App.tsx", line: 20, text: "const y = 2;" });

        const mainFile = result!.find((r) => r.file === "webview/main.tsx");
        expect(mainFile).toBeDefined();
        expect(mainFile!.matches[0]).toEqual({ file: "webview/main.tsx", line: 5, text: "import React from 'react';" });
    });

    it("returns null when fewer than half the lines match the ripgrep format", () => {
        const freeform = "This is a plain error message\nwith no ripgrep-style lines";
        expect(parseRipgrep(freeform)).toBeNull();
    });

    it("tolerates a mix of matching and non-matching lines if majority match", () => {
        const mixed = [
            "src/a.ts:1:hello",
            "src/a.ts:2:world",
            "src/a.ts:3:foo",
            "just a stray line",
        ].join("\n");
        // 3/4 lines match → ≥ 0.5 threshold → parsed
        const result = parseRipgrep(mixed);
        expect(result).not.toBeNull();
        expect(result![0].matches).toHaveLength(3);
    });

    it("preserves colons inside match text", () => {
        const result = parseRipgrep("src/a.ts:1:key: value");
        expect(result![0].matches[0].text).toBe("key: value");
    });
});

// ---------------------------------------------------------------------------
// parseUnifiedDiff
// ---------------------------------------------------------------------------

const UNIFIED_DIFF = [
    "@@ -1,3 +1,4 @@",
    " context line",
    "+added line",
    "-removed line",
    " another context",
].join("\n");

describe("parseUnifiedDiff", () => {
    it("returns a single empty context row for a bare empty string", () => {
        // split("\n") on "" yields [""], which produces one ctx row
        expect(parseUnifiedDiff("")).toHaveLength(1);
    });

    it("parses hunk header, adds, deletes, and context rows", () => {
        const rows = parseUnifiedDiff(UNIFIED_DIFF);
        expect(rows[0]).toEqual({ type: "hunk", marker: "@@", src: "@@ -1,3 +1,4 @@" });
        expect(rows[1]).toEqual({ type: "ctx", lineNum: 1, marker: " ", src: "context line" });
        expect(rows[2]).toEqual({ type: "add", lineNum: 2, marker: "+", src: "added line" });
        expect(rows[3]).toEqual({ type: "del", marker: "-", src: "removed line" });
        expect(rows[4]).toEqual({ type: "ctx", lineNum: 3, marker: " ", src: "another context" });
    });

    it("increments line numbers correctly across adds and context but not deletes", () => {
        const rows = parseUnifiedDiff(UNIFIED_DIFF);
        const lineNums = rows.filter((r) => r.lineNum !== undefined).map((r) => r.lineNum);
        expect(lineNums).toEqual([1, 2, 3]);
    });

    it("skips --- and +++ header lines", () => {
        const withHeaders = [
            "--- a/src/a.ts",
            "+++ b/src/a.ts",
            "@@ -1,1 +1,1 @@",
            "-old",
            "+new",
        ].join("\n");
        const rows = parseUnifiedDiff(withHeaders);
        expect(rows[0].type).toBe("hunk");
        expect(rows[1]).toEqual({ type: "del", marker: "-", src: "old" });
        expect(rows[2]).toEqual({ type: "add", lineNum: 1, marker: "+", src: "new" });
    });

    it("handles multiple hunks with correct line number tracking", () => {
        const multiHunk = [
            "@@ -1,2 +1,2 @@",
            " a",
            "+b",
            "@@ -10,2 +11,2 @@",
            " c",
            "+d",
        ].join("\n");
        const rows = parseUnifiedDiff(multiHunk);
        // Second hunk's context should start at line 11 (from @@ +11,2 @@)
        const secondCtx = rows.find((r, i) => i > 2 && r.type === "ctx");
        expect(secondCtx?.lineNum).toBe(11);
    });
});

// ---------------------------------------------------------------------------
// formatToolDisplayOutput
// ---------------------------------------------------------------------------

describe("formatToolDisplayOutput", () => {
    it("formats run_command_background JSON as a started process line", () => {
        const raw = JSON.stringify({
            processId: "293e7ae4",
            pid: 9264,
            command: "python -m unittest discover -s tests",
        });

        expect(formatToolDisplayOutput("run_command_background", raw)).toBe(
            "Started pid 9264 — python -m unittest discover -s tests",
        );
    });

    it("formats run_command_background without a pid", () => {
        const raw = JSON.stringify({
            processId: "293e7ae4",
            pid: null,
            command: "npm run test:ts",
        });

        expect(formatToolDisplayOutput("run_command_background", raw)).toBe("Started — npm run test:ts");
    });

    it("decodes read_process_output and appends an exit footer when needed", () => {
        const raw = JSON.stringify({
            output: "...........\r\n\r\nOK\r\n",
            cursor: 23,
            running: false,
            exitCode: 0,
            totalBytes: 23,
        });

        expect(formatToolDisplayOutput("read_process_output", raw)).toBe("...........\r\n\r\nOK\r\n[exit 0]");
    });

    it("does not duplicate an existing read_process_output exit footer", () => {
        const raw = JSON.stringify({
            output: "OK\r\n[exit 0]\r\n",
            cursor: 13,
            running: false,
            exitCode: 0,
            totalBytes: 13,
        });

        expect(formatToolDisplayOutput("read_process_output", raw)).toBe("OK\r\n[exit 0]\r\n");
    });

    it("adds a running footer for read_process_output with streamed output", () => {
        const raw = JSON.stringify({
            output: "still working\r\n",
            cursor: 15,
            running: true,
            exitCode: null,
            totalBytes: 4096,
        });

        expect(formatToolDisplayOutput("read_process_output", raw)).toBe(
            "still working\r\n[…running, 4096 bytes streamed]",
        );
    });

    it("passes unknown tool output through unchanged", () => {
        const raw = '{"output":"plain enough"}';
        expect(formatToolDisplayOutput("read_file", raw)).toBe(raw);
    });

    it("passes malformed JSON through unchanged for background process tools", () => {
        const raw = '{"output":';
        expect(formatToolDisplayOutput("run_command_background", raw)).toBe(raw);
        expect(formatToolDisplayOutput("read_process_output", raw)).toBe(raw);
    });

    it("returns an empty string for empty or whitespace-only input", () => {
        expect(formatToolDisplayOutput("run_command_background", "")).toBe("");
        expect(formatToolDisplayOutput("read_process_output", "  \n\t  ")).toBe("");
    });
});
