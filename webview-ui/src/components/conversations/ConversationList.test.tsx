import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionsIndex } from "../../../../src/shared/protocol";
import { ConversationList } from "./ConversationList";

describe("ConversationList", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("shows session creation age while retaining updated ordering", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-05-20T12:00:00Z"));
        const now = Date.now();
        const index: SessionsIndex = {
            version: 1,
            activeId: "newer",
            order: ["older", "newer"],
            sessions: {
                older: {
                    conversationId: "older",
                    title: "Older created but touched now",
                    createdAt: now - 3 * 86_400_000,
                    updatedAt: now,
                    messageCount: 1,
                    state: "active",
                    pinned: false,
                },
                newer: {
                    conversationId: "newer",
                    title: "Newer created",
                    createdAt: now - 5 * 60_000,
                    updatedAt: now - 60_000,
                    messageCount: 1,
                    state: "active",
                    pinned: false,
                },
            },
        };

        const html = renderToStaticMarkup(
            <ConversationList
                index={index}
                showArchived={false}
                onToggleArchived={() => { }}
                renamingId={null}
                onBeginRename={() => { }}
                onEndRename={() => { }}
                onNewConversation={() => { }}
                onSessionPicked={() => { }}
                searchResults={[]}
                onSearch={() => { }}
            />,
        );

        expect(html.indexOf("Older created but touched now")).toBeLessThan(html.indexOf("Newer created"));
        expect(html).toContain("3d");
        expect(html).toContain("5m");
        expect(html).not.toContain(">now<");
    });
});
