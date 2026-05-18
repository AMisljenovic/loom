import { describe, expect, it } from "vitest";
import { applyEdits, parseApplyDiffInput, type ApplyDiffEdit } from "./applyDiffEdits";

const FOUR = ["alpha", "beta", "gamma", "delta"].join("\n") + "\n";

describe("applyEdits — anchor mode", () => {
  it("replaces a unique anchor", () => {
    const out = applyEdits(FOUR, [{ kind: "anchor", oldText: "beta", newText: "BRAVO" }], "x.txt");
    expect(out).toBe("alpha\nBRAVO\ngamma\ndelta\n");
  });

  it("fails with line numbers when oldText is ambiguous", () => {
    const src = "x = 1\nx = 1\nx = 2\n";
    expect(() => applyEdits(src, [{ kind: "anchor", oldText: "x = 1", newText: "x = 9" }], "f.ts"))
      .toThrow(/found 2 times[\s\S]*Matches at lines: 1, 2/);
  });

  it("fails with not-found message and steers to range edit", () => {
    expect(() => applyEdits(FOUR, [{ kind: "anchor", oldText: "missing", newText: "x" }], "f.ts"))
      .toThrow(/oldText not found[\s\S]*range edit/);
  });
});

describe("applyEdits — range mode", () => {
  it("replaces a single line", () => {
    const out = applyEdits(FOUR, [{ kind: "range", startLine: 2, endLine: 2, newText: "BETA-2" }], "x");
    expect(out).toBe("alpha\nBETA-2\ngamma\ndelta\n");
  });

  it("replaces a multi-line range with multi-line newText", () => {
    const out = applyEdits(
      FOUR,
      [{ kind: "range", startLine: 2, endLine: 3, newText: "B1\nB2\nB3" }],
      "x",
    );
    expect(out).toBe("alpha\nB1\nB2\nB3\ndelta\n");
  });

  it("inserts without deleting when endLine = startLine - 1", () => {
    const out = applyEdits(
      FOUR,
      [{ kind: "range", startLine: 3, endLine: 2, newText: "INSERT" }],
      "x",
    );
    expect(out).toBe("alpha\nbeta\nINSERT\ngamma\ndelta\n");
  });

  it("appends past the last line", () => {
    const out = applyEdits(
      FOUR,
      [{ kind: "range", startLine: 5, endLine: 4, newText: "epsilon" }],
      "x",
    );
    expect(out).toBe("alpha\nbeta\ngamma\ndelta\nepsilon\n");
  });

  it("preserves CRLF line endings", () => {
    const src = "alpha\r\nbeta\r\ngamma\r\n";
    const out = applyEdits(src, [{ kind: "range", startLine: 2, endLine: 2, newText: "BETA" }], "x");
    expect(out).toBe("alpha\r\nBETA\r\ngamma\r\n");
  });

  it("rejects out-of-bounds endLine", () => {
    expect(() => applyEdits(FOUR, [{ kind: "range", startLine: 1, endLine: 99, newText: "x" }], "x"))
      .toThrow(/endLine 99 exceeds file length 4/);
  });

  it("rejects startLine < 1", () => {
    expect(() => applyEdits(FOUR, [{ kind: "range", startLine: 0, endLine: 1, newText: "x" }], "x"))
      .toThrow(/startLine must be >= 1/);
  });
});

describe("applyEdits — mixed and ordering", () => {
  it("applies range edits descending so earlier line numbers stay valid", () => {
    // src has 6 lines. Two range edits referencing the ORIGINAL line numbers.
    const src = ["1", "2", "3", "4", "5", "6"].join("\n") + "\n";
    const edits: ApplyDiffEdit[] = [
      { kind: "range", startLine: 2, endLine: 2, newText: "TWO" },
      { kind: "range", startLine: 5, endLine: 5, newText: "FIVE" },
    ];
    const out = applyEdits(src, edits, "x");
    expect(out).toBe("1\nTWO\n3\n4\nFIVE\n6\n");
  });

  it("mixes anchor and range — ranges first, anchors after", () => {
    const src = ["alpha", "beta", "gamma", "delta"].join("\n") + "\n";
    const edits: ApplyDiffEdit[] = [
      { kind: "anchor", oldText: "alpha", newText: "ALPHA" },
      { kind: "range", startLine: 3, endLine: 3, newText: "GAMMA" },
    ];
    const out = applyEdits(src, edits, "x");
    expect(out).toBe("ALPHA\nbeta\nGAMMA\ndelta\n");
  });
});

describe("parseApplyDiffInput", () => {
  it("parses an anchor edit", () => {
    const out = parseApplyDiffInput({ path: "a.ts", edits: [{ oldText: "x", newText: "y" }] });
    expect(out.edits[0]).toEqual({ kind: "anchor", oldText: "x", newText: "y" });
  });

  it("parses a range edit", () => {
    const out = parseApplyDiffInput({
      path: "a.ts",
      edits: [{ startLine: 5, endLine: 7, newText: "x" }],
    });
    expect(out.edits[0]).toEqual({ kind: "range", startLine: 5, endLine: 7, newText: "x" });
  });

  it("rejects an edit containing both oldText and startLine", () => {
    expect(() =>
      parseApplyDiffInput({
        path: "a.ts",
        edits: [{ oldText: "x", startLine: 1, endLine: 1, newText: "y" }],
      }),
    ).toThrow(/either oldText \(anchor\) or startLine\+endLine \(range\), not both/);
  });

  it("rejects an edit with neither anchor nor range", () => {
    expect(() => parseApplyDiffInput({ path: "a.ts", edits: [{ newText: "y" }] }))
      .toThrow(/provide either oldText \(anchor\) or startLine\+endLine \(range\)/);
  });

  it("rejects range edit missing endLine", () => {
    expect(() => parseApplyDiffInput({ path: "a.ts", edits: [{ startLine: 1, newText: "y" }] }))
      .toThrow(/range edit requires both startLine and endLine/);
  });

  it("rejects empty edits array", () => {
    expect(() => parseApplyDiffInput({ path: "a.ts", edits: [] })).toThrow(/at least one edit/);
  });
});
