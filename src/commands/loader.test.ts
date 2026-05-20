import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { scanCommands } from "./loader";

describe("scanCommands", () => {
  it("reads commands from .loom/commands", () => {
    const root = tempRoot();
    writeCommand(root, ".loom/commands/review.md", "review", "Review changes");

    const commands = scanCommands(root);
    expect(commands.map((c) => c.name)).toEqual(["review"]);
    expect(commands[0].source).toBe(".loom/commands/review.md");
    expect(commands[0].description).toBe("Review changes");
  });

  it("ignores foreign-format command folders", () => {
    const root = tempRoot();
    writeCommand(root, ".claude/commands/foreign.md", "foreign", "Claude command");
    writeCommand(root, ".codex/commands/another.md", "another", "Codex command");
    writeCommand(root, ".loom/commands/review.md", "review", "Loom review");

    expect(scanCommands(root).map((c) => c.name)).toEqual(["review"]);
  });

  it("returns empty when no .loom/commands exist", () => {
    const root = tempRoot();
    writeCommand(root, ".claude/commands/foreign.md", "foreign", "Claude command");
    expect(scanCommands(root)).toEqual([]);
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
