import { describe, expect, it } from "vitest";
import { safeMarkdownHref } from "./markdown";

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
