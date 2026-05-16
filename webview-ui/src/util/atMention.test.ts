import { describe, expect, it } from "vitest";
import { parseAtQuery, replaceAtQuery } from "./atMention";

describe("parseAtQuery", () => {
    it("returns null for empty text", () => {
        expect(parseAtQuery("", 0)).toBeNull();
    });

    it("returns null when cursor is not in an @token", () => {
        expect(parseAtQuery("hello world", 5)).toBeNull();
    });

    it("detects @token at start of text", () => {
        const text = "@src";
        const result = parseAtQuery(text, 4);
        expect(result).toEqual({ query: "src", start: 0, end: 4 });
    });

    it("detects @token after whitespace", () => {
        const text = "see @src/folder";
        const result = parseAtQuery(text, 8); // cursor after "@src"
        expect(result).toEqual({ query: "src", start: 4, end: 15 });
    });

    it("detects empty query immediately after @", () => {
        const text = "hello @";
        const result = parseAtQuery(text, 7);
        expect(result).toEqual({ query: "", start: 6, end: 7 });
    });

    it("returns null when @ is preceded by non-whitespace", () => {
        expect(parseAtQuery("foo@bar", 7)).toBeNull();
    });

    it("detects @token when cursor is in the middle of the token", () => {
        const text = "@somefile";
        // Cursor after "some" — query should be "some", end should be 9
        const result = parseAtQuery(text, 5);
        expect(result).toEqual({ query: "some", start: 0, end: 9 });
    });

    it("returns null when cursor is past the token (on whitespace)", () => {
        const text = "@src ";
        const result = parseAtQuery(text, 5); // cursor on space after token
        expect(result).toBeNull();
    });

    it("handles @token at end of longer sentence", () => {
        const text = "look at @agent/internal/loop";
        const result = parseAtQuery(text, text.length);
        expect(result).toEqual({ query: "agent/internal/loop", start: 8, end: text.length });
    });
});

describe("replaceAtQuery", () => {
    it("removes @token from start of text", () => {
        expect(replaceAtQuery("@src", 0, 4)).toBe("");
    });

    it("removes @token with text before and after", () => {
        expect(replaceAtQuery("see @src here", 4, 8)).toBe("see here");
    });

    it("removes @token at end", () => {
        expect(replaceAtQuery("look at @src", 8, 12)).toBe("look at");
    });

    it("removes @token that is the only content after a word", () => {
        expect(replaceAtQuery("hello @world", 6, 12)).toBe("hello");
    });

    it("handles empty query (@)", () => {
        expect(replaceAtQuery("hello @", 6, 7)).toBe("hello");
    });
});
