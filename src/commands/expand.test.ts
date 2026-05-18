import { describe, expect, it } from "vitest";
import { expandCommandBody } from "./expand";

describe("expandCommandBody", () => {
  it("substitutes full arguments and positional arguments", () => {
    expect(expandCommandBody("Review $ARGUMENTS in $1 then $2", "login flow")).toBe("Review login flow in login then flow");
  });

  it("leaves missing positional placeholders intact", () => {
    expect(expandCommandBody("Compare $1 and $2", "auth")).toBe("Compare auth and $2");
  });

  it("handles quoted positional arguments", () => {
    expect(expandCommandBody("Review $1", '"login flow"')).toBe("Review login flow");
  });
});
