import { describe, expect, it } from "vitest";
import { formatCount, formatDuration, formatAge, formatTokens } from "./format";

describe("formatTokens / formatCount", () => {
    it("returns plain number below 1k", () => {
        expect(formatTokens(0)).toBe("0");
        expect(formatTokens(999)).toBe("999");
        expect(formatCount(42)).toBe("42");
    });

    it("returns k notation from 1,000", () => {
        expect(formatTokens(1_000)).toBe("1.0k");
        expect(formatTokens(1_500)).toBe("1.5k");
        expect(formatTokens(999_999)).toBe("1000.0k");
        expect(formatCount(2_300)).toBe("2.3k");
    });

    it("returns M notation from 1,000,000", () => {
        expect(formatTokens(1_000_000)).toBe("1.0M");
        expect(formatTokens(2_500_000)).toBe("2.5M");
        expect(formatCount(1_000_000)).toBe("1.0M");
    });
});

describe("formatDuration", () => {
    it("returns ms for sub-second values", () => {
        expect(formatDuration(0)).toBe("0ms");
        expect(formatDuration(999)).toBe("999ms");
    });

    it("returns seconds with one decimal place", () => {
        expect(formatDuration(1_000)).toBe("1.0s");
        expect(formatDuration(1_500)).toBe("1.5s");
        expect(formatDuration(60_000)).toBe("60.0s");
    });
});

describe("formatAge", () => {
    it("returns 'now' for sub-minute timestamps", () => {
        expect(formatAge(Date.now() - 30_000)).toBe("now");
        expect(formatAge(Date.now())).toBe("now");
    });

    it("returns minutes for timestamps under an hour", () => {
        expect(formatAge(Date.now() - 5 * 60_000)).toBe("5m");
        expect(formatAge(Date.now() - 59 * 60_000)).toBe("59m");
    });

    it("returns hours for timestamps under a day", () => {
        expect(formatAge(Date.now() - 3 * 3_600_000)).toBe("3h");
        expect(formatAge(Date.now() - 23 * 3_600_000)).toBe("23h");
    });

    it("returns days for timestamps under a week", () => {
        expect(formatAge(Date.now() - 2 * 86_400_000)).toBe("2d");
        expect(formatAge(Date.now() - 6 * 86_400_000)).toBe("6d");
    });

    it("returns a locale date string for older timestamps", () => {
        const result = formatAge(Date.now() - 14 * 86_400_000);
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
    });
});
