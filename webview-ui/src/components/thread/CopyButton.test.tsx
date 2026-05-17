import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "./CopyButton";

// vitest runs in node by default in this repo (no jsdom). We provide
// minimal globals for the clipboard / document APIs under test.

interface FakeTextArea {
    value: string;
    setAttribute: (k: string, v: string) => void;
    select: () => void;
    style: Record<string, string>;
}

function installFakeDocument(execResult: boolean) {
    const exec = vi.fn().mockReturnValue(execResult);
    const fakeBody = { appendChild: vi.fn(), removeChild: vi.fn() };
    const createElement = vi.fn(
        (): FakeTextArea => ({
            value: "",
            setAttribute: vi.fn(),
            select: vi.fn(),
            style: {},
        }),
    );
    (globalThis as unknown as { document: unknown }).document = {
        createElement,
        body: fakeBody,
        execCommand: exec,
    };
    return { exec, createElement, fakeBody };
}

describe("copyToClipboard", () => {
    const hadNavigator = "navigator" in globalThis;
    const hadDocument = "document" in globalThis;

    afterEach(() => {
        if (!hadNavigator) {
            try {
                Object.defineProperty(globalThis, "navigator", { configurable: true, value: undefined });
            } catch {
                /* ignore — already removed */
            }
        }
        if (!hadDocument) delete (globalThis as Record<string, unknown>).document;
        vi.restoreAllMocks();
    });

    it("returns false for empty input without touching the clipboard", async () => {
        const writeText = vi.fn();
        Object.defineProperty(globalThis, "navigator", {
            configurable: true,
            value: { clipboard: { writeText } },
        });
        expect(await copyToClipboard("")).toBe(false);
        expect(writeText).not.toHaveBeenCalled();
    });

    it("uses navigator.clipboard.writeText when available", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(globalThis, "navigator", {
            configurable: true,
            value: { clipboard: { writeText } },
        });
        expect(await copyToClipboard("hello")).toBe(true);
        expect(writeText).toHaveBeenCalledWith("hello");
    });

    describe("execCommand fallback", () => {
        beforeEach(() => {
            Object.defineProperty(globalThis, "navigator", {
                configurable: true,
                value: {},
            });
        });

        it("falls back to document.execCommand when clipboard API is unavailable", async () => {
            const { exec } = installFakeDocument(true);
            expect(await copyToClipboard("via fallback")).toBe(true);
            expect(exec).toHaveBeenCalledWith("copy");
        });

        it("returns false if execCommand reports failure", async () => {
            installFakeDocument(false);
            expect(await copyToClipboard("nope")).toBe(false);
        });
    });

    it("falls back to execCommand if writeText rejects", async () => {
        const writeText = vi.fn().mockRejectedValue(new Error("denied"));
        Object.defineProperty(globalThis, "navigator", {
            configurable: true,
            value: { clipboard: { writeText } },
        });
        const { exec } = installFakeDocument(true);
        expect(await copyToClipboard("rescued")).toBe(true);
        expect(exec).toHaveBeenCalledWith("copy");
    });
});
