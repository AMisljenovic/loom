/**
 * Utilities for parsing and replacing @mention tokens in the composer textarea.
 * An @mention is a token starting with `@` that appears at the beginning of the
 * text or immediately after whitespace.
 */

export interface AtMention {
    /** Text typed after the `@` up to the cursor (used as the search query). */
    query: string;
    /** Index of the `@` character in the string. */
    start: number;
    /**
     * Index just past the last non-whitespace character of the full token
     * (i.e. the full extent of the `@token` including any chars typed after cursor).
     * Used to remove the entire token on selection.
     */
    end: number;
}

/**
 * Returns the active @mention token if the cursor is inside one, otherwise null.
 * A token is active when:
 *   - There is an `@` at or before cursorPos with no whitespace between it and cursorPos.
 *   - The `@` is at position 0, or preceded by whitespace.
 */
export function parseAtQuery(text: string, cursorPos: number): AtMention | null {
    if (cursorPos <= 0 && text[0] !== "@") return null;

    // Scan backward from the character just before the cursor.
    let i = cursorPos - 1;
    while (i >= 0 && text[i] !== "@" && !/\s/.test(text[i])) {
        i--;
    }

    if (i < 0 || text[i] !== "@") return null;

    // `@` must be at the start of the text or preceded by whitespace.
    if (i > 0 && !/\s/.test(text[i - 1])) return null;

    const start = i;
    const query = text.slice(start + 1, cursorPos);

    // Scan forward from cursor to find the full extent of the token.
    let end = cursorPos;
    while (end < text.length && !/\s/.test(text[end])) {
        end++;
    }

    return { query, start, end };
}

/**
 * Removes the `@token` (from `start` to `end`) from `text`.
 * Cleans up any extra whitespace left at the join point.
 */
export function replaceAtQuery(text: string, start: number, end: number): string {
    const before = text.slice(0, start);
    const after = text.slice(end);
    // Trim trailing whitespace from before and leading whitespace from after
    // only when both sides have content, to avoid collapsing intentional spacing.
    const trimBefore = before.trimEnd();
    const trimAfter = after.trimStart();
    if (trimBefore.length > 0 && trimAfter.length > 0) {
        return trimBefore + " " + trimAfter;
    }
    return trimBefore + trimAfter;
}
