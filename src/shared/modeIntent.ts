import type { ModeDefinition } from "./protocol";

export interface ModeSwitchIntent {
  modeId: string;
  label: string;
  prompt?: string;
}

const COMMAND_RE = /^\s*(?:(?:ok|okay|please|pls|now|then)\s+)*(switch(?:\s+(?:me|us|this|the task))?\s+to|change\s+to|use|continue\s+in|run(?:\s+(?:this|it))?\s+in|do\s+(?:this|it)\s+in)\s+(.+?)\s+mode\b[\s,.:;!-]*(?:(?:and|then)\s+)?([\s\S]*)$/i;

export function detectModeSwitchIntent(
  prompt: string,
  modes: Pick<ModeDefinition, "id" | "label">[],
): ModeSwitchIntent | undefined {
  const match = COMMAND_RE.exec(prompt);
  if (!match) {
    return undefined;
  }

  const command = normalizeSpaces(match[1] ?? "");
  const requested = normalizeModeName(match[2] ?? "");
  const mode = modes.find((m) => (
    normalizeModeName(m.id) === requested ||
    normalizeModeName(m.label) === requested
  ));
  if (!mode) {
    return undefined;
  }

  const tail = normalizePromptTail(match[3] ?? "");
  const promptTail = tail || (command === "continue in" ? "continue" : undefined);
  return {
    modeId: mode.id,
    label: mode.label,
    prompt: promptTail,
  };
}

function normalizeModeName(value: string): string {
  return normalizeSpaces(value)
    .replace(/[-_]+/g, " ")
    .toLowerCase();
}

function normalizeSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizePromptTail(value: string): string | undefined {
  const trimmed = value.trim().replace(/^[,.:;!-]+/, "").trim();
  return trimmed || undefined;
}
