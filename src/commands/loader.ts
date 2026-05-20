import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandCatalogueEntry } from "../shared/protocol";

// scanCommands reads slash commands from <workspace>/.loom/commands/*.md.
// Foreign-format folders (.claude/commands, .codex/commands) are not read —
// keep all commands under .loom/commands/.
export function scanCommands(workspaceRoot: string): CommandCatalogueEntry[] {
  if (!workspaceRoot) return [];
  const byName = new Map<string, CommandCatalogueEntry>();
  loadCommandDir(byName, workspaceRoot, ".loom/commands");
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function loadCommandDir(byName: Map<string, CommandCatalogueEntry>, workspaceRoot: string, relDir: string): number {
  if (!relDir) return 0;
  const dir = path.join(workspaceRoot, relDir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let read = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const rel = path.posix.join(relDir, entry.name);
    const full = path.join(workspaceRoot, rel);
    let text: string;
    try {
      text = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const parsed = parseCommand(text, rel, path.basename(entry.name, path.extname(entry.name)));
    if (!parsed) continue;
    byName.set(parsed.name, parsed);
    read++;
  }
  return read;
}

function parseCommand(text: string, source: string, defaultName: string): CommandCatalogueEntry | undefined {
  const split = splitFrontmatter(text);
  if (!split) return undefined;
  const { frontmatter, body } = split;
  let name = defaultName;
  let description = "";
  let argumentHint = "";
  for (const raw of frontmatter.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "name") name = value;
    else if (key === "description") description = value;
    else if (key === "argument-hint") argumentHint = value;
  }
  if (!name) return undefined;
  return { name, description, argumentHint, body, source };
}

function splitFrontmatter(text: string): { frontmatter: string; body: string } | undefined {
  const trimmed = text.replace(/^\s+/, "");
  if (!trimmed.startsWith("---")) return undefined;
  const rest = trimmed.slice(3);
  const end = rest.indexOf("---");
  if (end < 0) return undefined;
  return {
    frontmatter: rest.slice(0, end),
    body: rest.slice(end + 3).replace(/^[\r\n]+/, ""),
  };
}
