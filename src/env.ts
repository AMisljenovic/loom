import * as fs from "node:fs";
import * as path from "node:path";

// Tiny .env parser. Avoids pulling in a runtime dependency.
//
// Supported:
//   KEY=value
//   KEY="value with spaces"
//   KEY='value'
//   # comment lines and blank lines are ignored
//   trailing whitespace on values is trimmed
//
// Not supported (intentionally): variable expansion, multiline values,
// escape sequences. Keep it simple — if a user needs more, they can pass
// values through VS Code settings instead.
export function loadDotEnv(workspaceRoot: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!workspaceRoot) return out;

  const file = path.join(workspaceRoot, ".env");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}
