import type { ConversationState, LlmMessage, Msg, SessionMeta } from "./protocol";

export function sanitizeFileBase(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 60) || "loom-session";
}

export function sliceLlmMessagesByUserTurns(llmMessages: LlmMessage[], userTurns: number): LlmMessage[] {
  if (userTurns <= 0) return [];
  let seen = 0;
  for (let i = 0; i < llmMessages.length; i++) {
    if (llmMessages[i].role === "user") {
      seen++;
      if (seen > userTurns) {
        return llmMessages.slice(0, i);
      }
    }
  }
  return [...llmMessages];
}

export function messageSearchText(msg: Msg): string {
  if (msg.role === "user" || msg.role === "assistant") return msg.text;
  if (msg.role === "tool") {
    const parts: string[] = [msg.name];
    if (msg.input && typeof msg.input === "object") {
      for (const v of Object.values(msg.input as Record<string, unknown>)) {
        if (typeof v === "string") parts.push(v);
      }
    }
    if (msg.output) parts.push(msg.output);
    return parts.join(" ");
  }
  if (msg.role === "question") return msg.title ?? "";
  if (msg.role === "subagent") return [msg.task, msg.summary ?? ""].join(" ");
  if (msg.role === "progress") return msg.text;
  return "";
}

export function renderSessionAsMarkdown(meta: SessionMeta, body: ConversationState): string {
  const lines: string[] = [];
  lines.push(`# ${meta.title || "Untitled session"}`);
  lines.push("");
  lines.push(`- Conversation ID: \`${meta.conversationId}\``);
  lines.push(`- Created: ${new Date(meta.createdAt).toISOString()}`);
  lines.push(`- Updated: ${new Date(meta.updatedAt).toISOString()}`);
  if (meta.parent) {
    lines.push(`- Branched from: \`${meta.parent.conversationId}\` at message ${meta.parent.messageIndex}`);
  }
  lines.push("");
  for (const msg of body.messages) {
    if (msg.role === "user") {
      lines.push("## User");
      lines.push("");
      lines.push(msg.text);
      if (msg.references && msg.references.length > 0) {
        lines.push("");
        lines.push("**References:**");
        for (const ref of msg.references) {
          lines.push(`- \`${ref.path}\` (${ref.kind})`);
        }
      }
    } else if (msg.role === "assistant") {
      lines.push(`## Assistant${msg.kind === "summary" ? " (summary)" : msg.kind === "error" ? " (error)" : ""}`);
      lines.push("");
      lines.push(msg.text);
    } else if (msg.role === "tool") {
      lines.push(`## Tool: \`${msg.name}\` — ${msg.status}`);
      if (msg.input !== undefined) {
        lines.push("");
        lines.push("```json");
        try { lines.push(JSON.stringify(msg.input, null, 2)); } catch { lines.push(String(msg.input)); }
        lines.push("```");
      }
      if (msg.output) {
        lines.push("");
        lines.push("```");
        lines.push(msg.output);
        lines.push("```");
      }
    } else if (msg.role === "question") {
      lines.push(`## Question${msg.title ? `: ${msg.title}` : ""}`);
      for (const q of msg.questions) {
        lines.push(`- ${q.question}`);
      }
    } else if (msg.role === "subagent") {
      lines.push(`## Sub-agent (${msg.type}) — ${msg.status}`);
      lines.push("");
      lines.push(msg.task);
      if (msg.summary) {
        lines.push("");
        lines.push(msg.summary);
      }
    } else if (msg.role === "progress") {
      lines.push(`> ${msg.text}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
