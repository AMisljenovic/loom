import { describe, expect, it } from "vitest";
import {
  mergeReferenceAttachments,
  normalizeReferenceAttachments,
  normalizeReferencePath,
  referencePickerEntries,
  referenceId,
  referenceLabel,
} from "./references";

describe("references", () => {
  it("normalizes workspace-relative paths", () => {
    expect(normalizeReferencePath("src\\panel\\ChatPanel.ts")).toBe("src/panel/ChatPanel.ts");
    expect(normalizeReferencePath("./src//App.tsx")).toBe("src/App.tsx");
    expect(normalizeReferencePath(".")).toBe(".");
  });

  it("rejects absolute and escaping paths", () => {
    expect(normalizeReferencePath("C:/repo/file.ts")).toBeUndefined();
    expect(normalizeReferencePath("/repo/file.ts")).toBeUndefined();
    expect(normalizeReferencePath("../file.ts")).toBeUndefined();
    expect(normalizeReferencePath("src/../../file.ts")).toBeUndefined();
  });

  it("deduplicates by kind and normalized path", () => {
    expect(normalizeReferenceAttachments([
      { kind: "file", path: "src\\a.ts" },
      { kind: "file", path: "src/a.ts", label: "ignored" },
      { kind: "folder", path: "src" },
    ])).toEqual([
      { id: "file:src/a.ts", kind: "file", path: "src/a.ts", label: "a.ts" },
      { id: "folder:src", kind: "folder", path: "src", label: "src" },
    ]);
  });

  it("merges existing and added references", () => {
    expect(mergeReferenceAttachments(
      [{ id: "file:src/a.ts", kind: "file", path: "src/a.ts", label: "a.ts" }],
      [{ id: "file:src/a.ts", kind: "file", path: "src/a.ts" }, { id: "folder:docs", kind: "folder", path: "docs" }],
    )).toEqual([
      { id: "file:src/a.ts", kind: "file", path: "src/a.ts", label: "a.ts" },
      { id: "folder:docs", kind: "folder", path: "docs", label: "docs" },
    ]);
  });
});

describe("referenceId", () => {
  it("combines kind and path", () => {
    expect(referenceId("file", "src/App.tsx")).toBe("file:src/App.tsx");
    expect(referenceId("folder", "webview-ui/src")).toBe("folder:webview-ui/src");
  });
});

describe("referenceLabel", () => {
  it("returns the last path segment", () => {
    expect(referenceLabel("src/panel/ChatPanel.ts")).toBe("ChatPanel.ts");
    expect(referenceLabel("webview-ui/src")).toBe("src");
  });

  it("returns dot for the workspace root shorthand", () => {
    expect(referenceLabel(".")).toBe(".");
  });

  it("handles single-segment paths", () => {
    expect(referenceLabel("README.md")).toBe("README.md");
  });
});

describe("normalizeReferenceAttachments edge cases", () => {
  it("returns empty array for non-array input", () => {
    expect(normalizeReferenceAttachments(null)).toEqual([]);
    expect(normalizeReferenceAttachments(undefined)).toEqual([]);
    expect(normalizeReferenceAttachments("string")).toEqual([]);
  });

  it("skips entries with invalid kind", () => {
    expect(normalizeReferenceAttachments([
      { kind: "symlink", path: "src/a.ts" },
    ])).toEqual([]);
  });

  it("skips entries with absolute or escaping paths", () => {
    expect(normalizeReferenceAttachments([
      { kind: "file", path: "C:/absolute.ts" },
      { kind: "file", path: "../escape.ts" },
    ])).toEqual([]);
  });

  it("preserves explicit label when valid", () => {
    expect(normalizeReferenceAttachments([
      { kind: "file", path: "src/a.ts", label: "  my label  " },
    ])).toEqual([
      { id: "file:src/a.ts", kind: "file", path: "src/a.ts", label: "my label" },
    ]);
  });

  it("falls back to derived label when label is blank", () => {
    expect(normalizeReferenceAttachments([
      { kind: "file", path: "src/a.ts", label: "   " },
    ])).toEqual([
      { id: "file:src/a.ts", kind: "file", path: "src/a.ts", label: "a.ts" },
    ]);
  });

  it("accepts valid image references", () => {
    expect(normalizeReferenceAttachments([
      { id: "image:1", kind: "image", label: "shot.png", mimeType: "image/png", data: "aGVsbG8=", size: 5 },
    ])).toEqual([
      { id: "image:1", kind: "image", label: "shot.png", mimeType: "image/png", data: "aGVsbG8=", size: 5 },
    ]);
  });

  it("rejects invalid image references", () => {
    expect(normalizeReferenceAttachments([
      { id: "image:bad-type", kind: "image", mimeType: "image/bmp", data: "aGVsbG8=", size: 5 },
      { id: "image:too-large", kind: "image", mimeType: "image/png", data: "aGVsbG8=", size: 6 * 1024 * 1024 },
      { id: "image:bad-data", kind: "image", mimeType: "image/png", data: "not base64!", size: 5 },
    ])).toEqual([]);
  });
});

describe("referencePickerEntries", () => {
  it("returns folders and files from the workspace index with picked state", () => {
    expect(referencePickerEntries(
      { folders: ["src", "docs"], files: ["src/a.ts", "README.md"] },
      [{ id: "file:README.md", kind: "file", path: "README.md", label: "README.md" }],
    )).toEqual([
      { description: "folder", picked: false, ref: { id: "folder:docs", kind: "folder", path: "docs", label: "docs" } },
      { description: "folder", picked: false, ref: { id: "folder:src", kind: "folder", path: "src", label: "src" } },
      { description: "file", picked: true, ref: { id: "file:README.md", kind: "file", path: "README.md", label: "README.md" } },
      { description: "file", picked: false, ref: { id: "file:src/a.ts", kind: "file", path: "src/a.ts", label: "a.ts" } },
    ]);
  });
});
