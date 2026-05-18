import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Msg } from "../../../../src/shared/protocol";
import { SubAgentCard } from "./SubAgentCard";

function makeMsg(overrides: Partial<Extract<Msg, { role: "subagent" }>> = {}): Extract<Msg, { role: "subagent" }> {
    return {
        role: "subagent",
        parentTaskId: "parent",
        subTaskId: "sub-1",
        type: "research",
        task: "Find every place auth tokens are persisted.",
        status: "running",
        trace: [{ role: "user", text: "Find every place auth tokens are persisted." }],
        expanded: false,
        ...overrides,
    };
}

describe("SubAgentCard", () => {
    it("renders the SUB-AGENT tag so users can spot delegated work", () => {
        const html = renderToStaticMarkup(
            <SubAgentCard
                msg={makeMsg()}
                pendingDiffs={new Map()}
                pendingOutputs={new Map()}
                onToggleToolExpanded={() => { }}
            />,
        );

        expect(html).toContain("subagent-tag");
        expect(html).toContain("Sub-agent");
        expect(html).toContain("subagent-card subagent-running");
        expect(html).toContain("Find every place auth tokens are persisted");
    });

    it("shows the completed status without a running pip class", () => {
        const html = renderToStaticMarkup(
            <SubAgentCard
                msg={makeMsg({ status: "completed", summary: "Done." })}
                pendingDiffs={new Map()}
                pendingOutputs={new Map()}
                onToggleToolExpanded={() => { }}
            />,
        );

        expect(html).toContain("subagent-card subagent-completed");
        expect(html).not.toContain("subagent-pip running");
    });
});
