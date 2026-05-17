import { describe, expect, it } from "vitest";
import { safeMarkdownHref, stripStructuralTags } from "./markdown";

describe("safeMarkdownHref", () => {
  it("allows ordinary web links", () => {
    expect(safeMarkdownHref("https://example.com/docs")).toBe("https://example.com/docs");
    expect(safeMarkdownHref("http://localhost:3000")).toBe("http://localhost:3000");
    expect(safeMarkdownHref("mailto:hello@example.com")).toBe("mailto:hello@example.com");
  });

  it("rejects unsafe or relative links", () => {
    expect(safeMarkdownHref("javascript:alert(1)")).toBeUndefined();
    expect(safeMarkdownHref("command:workbench.action.reloadWindow")).toBeUndefined();
    expect(safeMarkdownHref("/relative/path")).toBeUndefined();
  });
});

describe("stripStructuralTags", () => {
  it("removes proposed_plan wrappers but keeps the contents", () => {
    const input = "<proposed_plan>\n# Plan\n\n- step 1\n</proposed_plan>";
    expect(stripStructuralTags(input)).toBe("# Plan\n\n- step 1");
  });

  it("removes references and diagnostics-followup tags", () => {
    expect(stripStructuralTags("before <references>x</references> after")).toBe("before x after");
    expect(stripStructuralTags("<diagnostics-followup>err</diagnostics-followup>")).toBe("err");
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(stripStructuralTags("</Proposed_Plan>")).toBe("");
    expect(stripStructuralTags("<proposed_plan >body</proposed_plan >")).toBe("body");
  });

  it("leaves unrelated tags alone", () => {
    expect(stripStructuralTags("inline <b>bold</b> text")).toBe("inline <b>bold</b> text");
  });

  it("collapses runs of blank lines produced by tag removal", () => {
    const input = "intro\n\n<proposed_plan>\n\n\nbody\n\n\n</proposed_plan>\n\ntail";
    expect(stripStructuralTags(input)).toBe("intro\n\nbody\n\ntail");
  });

  it("returns empty input unchanged", () => {
    expect(stripStructuralTags("")).toBe("");
  });
});
