import type { ReferenceAttachment, ReferenceKind } from "./protocol";

export function normalizeReferencePath(value: string): string | undefined {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!normalized) return undefined;
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")) return undefined;
  const parts = normalized.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) return undefined;
  return parts.join("/") || ".";
}

export function referenceId(kind: ReferenceKind, path: string): string {
  return `${kind}:${path}`;
}

export function referenceLabel(path: string): string {
  if (path === ".") return ".";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function normalizeReferenceAttachments(input: unknown): ReferenceAttachment[] {
  if (!Array.isArray(input)) return [];
  const out: ReferenceAttachment[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Partial<ReferenceAttachment>;
    if (item.kind !== "file" && item.kind !== "folder") continue;
    if (typeof item.path !== "string") continue;
    const path = normalizeReferencePath(item.path);
    if (!path) continue;
    const id = referenceId(item.kind, path);
    if (seen.has(id)) continue;
    seen.add(id);
    const label = typeof item.label === "string" && item.label.trim()
      ? item.label.trim()
      : referenceLabel(path);
    out.push({ id, kind: item.kind, path, label });
  }
  return out;
}

export function mergeReferenceAttachments(
  existing: ReferenceAttachment[],
  added: ReferenceAttachment[],
): ReferenceAttachment[] {
  return normalizeReferenceAttachments([...existing, ...added]);
}
