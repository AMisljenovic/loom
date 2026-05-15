import type { ModeDefinition } from "./shared/protocol";

export const BUILTIN_MODES: ModeDefinition[] = [
  {
    id: "code",
    label: "Code",
  },
  {
    id: "architect",
    label: "Architect",
    toolDenylist: ["apply_diff"],
  },
  {
    id: "ask",
    label: "Ask",
    toolAllowlist: [],
  },
  {
    id: "debug",
    label: "Debug",
  },
];

export function mergeModes(
  builtins: ModeDefinition[],
  userModes: ModeDefinition[],
): ModeDefinition[] {
  const merged = new Map<string, ModeDefinition>(builtins.map((m) => [m.id, m]));
  for (const m of userModes) {
    merged.set(m.id, m);
  }
  return Array.from(merged.values());
}
