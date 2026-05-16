import type { Msg, ProgressPhase } from "./protocol";

export function progressKey(phase: ProgressPhase, text: string): string {
  return `${phase}:${text.trim().replace(/\s+/g, " ")}`;
}

export function shouldAppendProgress(messages: Msg[], phase: ProgressPhase, text: string): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "progress") return true;
  const key = progressKey(phase, text);
  return progressKey(last.phase, last.text) !== key;
}
