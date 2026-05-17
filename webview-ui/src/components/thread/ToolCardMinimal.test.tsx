import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Msg } from "../../../../src/shared/protocol";
import { ToolCardMinimal } from "./ToolCardMinimal";

function renderTool(msg: Extract<Msg, { role: "tool" }>, liveOutput?: string): string {
    return renderToStaticMarkup(
        <ToolCardMinimal
            msg={msg}
            liveOutput={liveOutput}
            onToggleExpanded={() => undefined}
        />,
    );
}

function tool(overrides: Partial<Extract<Msg, { role: "tool" }>> = {}): Extract<Msg, { role: "tool" }> {
    return {
        role: "tool",
        name: "run_command",
        status: "done",
        callId: "call-1",
        input: { command: "python -m unittest discover -s tests -v" },
        output: "line 1\nline 2\nline 3\nline 4",
        expanded: false,
        ...overrides,
    };
}

describe("ToolCardMinimal", () => {
    it("keeps collapsed tool cards compact with only the output peek", () => {
        const html = renderTool(tool());

        expect(html).toContain('class="tc-mini tc-done"');
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain("line 1\nline 2\nline 3");
        expect(html).toContain("…");
        expect(html).not.toContain('class="tc-expand"');
        expect(html).not.toContain(">args<");
        expect(html).not.toContain("approval-panel");
    });

    it("renders full output and args when expanded", () => {
        const html = renderTool(tool({ expanded: true }));

        expect(html).toContain('class="tc-mini tc-done expanded"');
        expect(html).toContain('aria-expanded="true"');
        expect(html).toContain('class="tc-expand"');
        expect(html).toContain(">output<");
        expect(html).toContain("line 4");
        expect(html).toContain(">args<");
        expect(html).toContain("&quot;command&quot;: &quot;python -m unittest discover -s tests -v&quot;");
    });

    it("renders pending approval controls only inside an expanded pending card", () => {
        const pending = tool({ status: "pending", output: undefined, expanded: false });

        const collapsed = renderTool(pending);
        expect(collapsed).toContain("WAITING".toLowerCase());
        expect(collapsed).not.toContain("approval-panel");
        expect(collapsed).not.toContain("(awaiting approval)");

        const expanded = renderTool({ ...pending, expanded: true });
        expect(expanded).toContain("(awaiting approval)");
        expect(expanded).toContain('class="tc-pending"');
        expect(expanded).toContain("Allow <strong>run_command</strong>?");
        expect(expanded).toContain("Approve");
        expect(expanded).toContain("Reject");
    });

    it("prefers live output while a tool is running", () => {
        const html = renderTool(tool({ status: "running", expanded: true, output: "stale" }), "fresh live chunk");

        expect(html).toContain("fresh live chunk");
        expect(html).not.toContain(">stale<");
    });
});
