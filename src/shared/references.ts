import type { ImageReferenceAttachment, PathReferenceAttachment, ReferenceAttachment, ReferenceKind } from "./protocol";

export const MAX_IMAGE_REFERENCE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_REFERENCES_PER_TURN = 4;
export const IMAGE_REFERENCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

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

export interface WorkspaceReferenceIndex {
  files: string[];
  folders: string[];
}

export interface ReferencePickerEntry {
  ref: PathReferenceAttachment;
  description: "file" | "folder";
  picked: boolean;
}

export function referencePickerEntries(
  index: WorkspaceReferenceIndex | undefined,
  existing: unknown,
): ReferencePickerEntry[] {
  if (!index) return [];
  const existingIds = new Set(normalizeReferenceAttachments(existing).map((ref) => ref.id));
  const entries: ReferencePickerEntry[] = [];
  const seen = new Set<string>();
  const add = (kind: "file" | "folder", rawPath: string) => {
    const path = normalizeReferencePath(rawPath);
    if (!path) return;
    const ref: PathReferenceAttachment = { id: referenceId(kind, path), kind, path, label: referenceLabel(path) };
    if (seen.has(ref.id)) return;
    seen.add(ref.id);
    entries.push({ ref, description: kind, picked: existingIds.has(ref.id) });
  };
  for (const folder of index.folders) add("folder", folder);
  for (const file of index.files) add("file", file);
  entries.sort((a, b) => {
    const ad = a.description === "folder" ? 0 : 1;
    const bd = b.description === "folder" ? 0 : 1;
    return ad - bd || a.ref.path.localeCompare(b.ref.path);
  });
  return entries;
}

export function normalizeReferenceAttachments(input: unknown): ReferenceAttachment[] {
  if (!Array.isArray(input)) return [];
  const out: ReferenceAttachment[] = [];
  const seen = new Set<string>();
  let imageCount = 0;
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Partial<ReferenceAttachment>;
    if (item.kind === "file" || item.kind === "folder") {
      const normalized = normalizePathReference(item);
      if (!normalized || seen.has(normalized.id)) continue;
      seen.add(normalized.id);
      out.push(normalized);
      continue;
    }
    if (item.kind === "image") {
      if (imageCount >= MAX_IMAGE_REFERENCES_PER_TURN) continue;
      const normalized = normalizeImageReference(item);
      if (!normalized || seen.has(normalized.id)) continue;
      seen.add(normalized.id);
      out.push(normalized);
      imageCount++;
    }
  }
  return out;
}

function normalizePathReference(item: Partial<ReferenceAttachment>): PathReferenceAttachment | undefined {
  if (item.kind !== "file" && item.kind !== "folder") return undefined;
  if (typeof item.path !== "string") return undefined;
  const path = normalizeReferencePath(item.path);
  if (!path) return undefined;
  const label = typeof item.label === "string" && item.label.trim()
    ? item.label.trim()
    : referenceLabel(path);
  return { id: referenceId(item.kind, path), kind: item.kind, path, label };
}

function normalizeImageReference(item: Partial<ReferenceAttachment>): ImageReferenceAttachment | undefined {
  if (item.kind !== "image") return undefined;
  if (typeof item.id !== "string" || !item.id.trim()) return undefined;
  if (typeof item.mimeType !== "string" || !IMAGE_REFERENCE_MIME_TYPES.has(item.mimeType)) return undefined;
  if (typeof item.data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.data)) return undefined;
  if (typeof item.size !== "number" || !Number.isFinite(item.size) || item.size <= 0 || item.size > MAX_IMAGE_REFERENCE_BYTES) return undefined;
  const label = typeof item.label === "string" && item.label.trim()
    ? item.label.trim()
    : "Pasted image";
  return {
    id: item.id.trim(),
    kind: "image",
    label,
    mimeType: item.mimeType,
    data: item.data,
    size: Math.floor(item.size),
  };
}

export function mergeReferenceAttachments(
  existing: ReferenceAttachment[],
  added: ReferenceAttachment[],
): ReferenceAttachment[] {
  return normalizeReferenceAttachments([...existing, ...added]);
}
