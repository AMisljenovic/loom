import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { scanCommands } from "./loader";

describe("scanCommands", () => {
  it("uses the active provider family", () => {
    const root = tempRoot();
    writeCommand(root, ".claude/commands/review.md", "review", "Claude review");
    writeCommand(root, ".codex/commands/check.md", "check", "Codex check");

    expect(scanCommands(root, "anthropic").map((c) => c.name)).toEqual(["review"]);
    expect(scanCommands(root, "openai").map((c) => c.name)).toEqual(["check"]);
  });

  it(".loom commands override external commands", () => {
    const root = tempRoot();
    writeCommand(root, ".claude/commands/review.md", "review", "External review");
    writeCommand(root, ".loom/commands/review.md", "review", "Loom review");

    const [command] = scanCommands(root, "anthropic");
    expect(command.name).toBe("review");
    expect(command.description).toBe("Loom review");
    expect(command.source).toBe(".loom/commands/review.md");
  });

  it("falls back to the opposite family only when native is empty", () => {
    const root = tempRoot();
    writeCommand(root, ".codex/commands/check.md", "check", "Codex fallback");
    expect(scanCommands(root, "anthropic").map((c) => c.name)).toEqual(["check"]);

    writeCommand(root, ".claude/commands/review.md", "review", "Claude native");
    expect(scanCommands(root, "anthropic").map((c) => c.name)).toEqual(["review"]);
  });
});

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "loom-commands-"));
}

function writeCommand(root: string, rel: string, name: string, description: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `---\nname: ${name}\ndescription: ${description}\nargument-hint: target\n---\nRun $ARGUMENTS`, "utf8");
}
