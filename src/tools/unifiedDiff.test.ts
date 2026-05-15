import { describe, expect, it } from "vitest";
import { createUnifiedDiff } from "./unifiedDiff";

describe("createUnifiedDiff", () => {
  it("snapshots a created file", () => {
    expect(createUnifiedDiff("new.txt", "", "alpha\nbeta\n")).toMatchInlineSnapshot(`
      "Index: new.txt
      ===================================================================
      --- new.txt
      +++ new.txt
      @@ -0,0 +1,2 @@
      +alpha
      +beta
      "
    `);
  });

  it("snapshots a modified line", () => {
    expect(createUnifiedDiff("a.txt", "one\ntwo\n", "one\nthree\n")).toMatchInlineSnapshot(`
      "Index: a.txt
      ===================================================================
      --- a.txt
      +++ a.txt
      @@ -1,2 +1,2 @@
       one
      -two
      +three
      "
    `);
  });

  it("snapshots a deleted line", () => {
    expect(createUnifiedDiff("a.txt", "one\ntwo\nthree\n", "one\nthree\n")).toMatchInlineSnapshot(`
      "Index: a.txt
      ===================================================================
      --- a.txt
      +++ a.txt
      @@ -1,3 +1,2 @@
       one
      -two
       three
      "
    `);
  });
});
