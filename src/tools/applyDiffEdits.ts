import { recoverableApplyDiffError } from "./applyDiffRecovery";

export type ApplyDiffEdit =
  | { kind: "anchor"; oldText: string; newText: string }
  | { kind: "range"; startLine: number; endLine: number; newText: string };

export interface ApplyDiffInput {
  path: string;
  edits: ApplyDiffEdit[];
}

export function parseApplyDiffInput(input: unknown): ApplyDiffInput {
  const candidate = input as { path?: unknown; edits?: unknown };
  if (typeof candidate.path !== "string" || !Array.isArray(candidate.edits)) {
    throw new Error("apply_diff requires path and edits");
  }
  const edits = candidate.edits.map((raw, i) => parseApplyDiffEdit(raw, i + 1));
  if (edits.length === 0) {
    throw new Error("apply_diff requires at least one edit");
  }
  return { path: candidate.path, edits };
}

function parseApplyDiffEdit(raw: unknown, editNumber: number): ApplyDiffEdit {
  const e = raw as { oldText?: unknown; newText?: unknown; startLine?: unknown; endLine?: unknown };
  if (typeof e.newText !== "string") {
    throw new Error(`edit ${editNumber}: newText must be a string`);
  }
  const hasAnchor = typeof e.oldText === "string";
  const hasRange = typeof e.startLine === "number" || typeof e.endLine === "number";
  if (hasAnchor && hasRange) {
    throw new Error(`edit ${editNumber}: provide either oldText (anchor) or startLine+endLine (range), not both`);
  }
  if (!hasAnchor && !hasRange) {
    throw new Error(`edit ${editNumber}: provide either oldText (anchor) or startLine+endLine (range)`);
  }
  if (hasRange) {
    if (typeof e.startLine !== "number" || typeof e.endLine !== "number") {
      throw new Error(`edit ${editNumber}: range edit requires both startLine and endLine numbers`);
    }
    return { kind: "range", startLine: e.startLine, endLine: e.endLine, newText: e.newText };
  }
  return { kind: "anchor", oldText: e.oldText as string, newText: e.newText };
}

export function applyEdits(source: string, edits: ApplyDiffEdit[], relPath: string): string {
  // Range edits go first, in descending startLine order, so earlier line
  // numbers stay valid. Anchor edits then apply to the resulting buffer.
  const ranges: Array<{ edit: Extract<ApplyDiffEdit, { kind: "range" }>; originalIndex: number }> = [];
  const anchors: Array<{ edit: Extract<ApplyDiffEdit, { kind: "anchor" }>; originalIndex: number }> = [];
  edits.forEach((edit, originalIndex) => {
    if (edit.kind === "range") ranges.push({ edit, originalIndex });
    else anchors.push({ edit, originalIndex });
  });
  ranges.sort((a, b) => b.edit.startLine - a.edit.startLine);

  let buffer = source;
  for (const { edit, originalIndex } of ranges) {
    buffer = applyRangeEdit(buffer, edit, originalIndex + 1, relPath);
  }
  for (const { edit, originalIndex } of anchors) {
    buffer = applyAnchorEdit(buffer, edit, originalIndex + 1, relPath);
  }
  return buffer;
}

function applyAnchorEdit(
  buffer: string,
  edit: Extract<ApplyDiffEdit, { kind: "anchor" }>,
  editNumber: number,
  relPath: string,
): string {
  if (edit.oldText === "") {
    throw new Error(`edit ${editNumber}: oldText must not be empty for existing files`);
  }
  const occurrences = findOccurrences(buffer, edit.oldText);
  if (occurrences.length === 0) {
    throw new Error(recoverableApplyDiffError(relPath, editNumber, "oldText not found"));
  }
  if (occurrences.length > 1) {
    const lineNumbers = occurrences.map((offset) => byteOffsetToLine(buffer, offset));
    throw new Error(
      recoverableApplyDiffError(
        relPath,
        editNumber,
        `oldText found ${occurrences.length} times`,
        lineNumbers,
      ),
    );
  }
  return buffer.replace(edit.oldText, edit.newText);
}

function applyRangeEdit(
  buffer: string,
  edit: Extract<ApplyDiffEdit, { kind: "range" }>,
  editNumber: number,
  relPath: string,
): string {
  void relPath;
  const eol = detectEol(buffer);
  const trailingEol = buffer.endsWith(eol);
  const body = trailingEol ? buffer.slice(0, -eol.length) : buffer;
  const lines = body.length === 0 ? [] : body.split(eol);
  const totalLines = lines.length;

  const { startLine, endLine } = edit;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
    throw new Error(`edit ${editNumber}: startLine/endLine must be integers`);
  }
  if (startLine < 1) {
    throw new Error(`edit ${editNumber}: startLine must be >= 1 (got ${startLine})`);
  }
  if (endLine < startLine - 1) {
    throw new Error(`edit ${editNumber}: endLine must be >= startLine - 1 (got start=${startLine}, end=${endLine})`);
  }
  if (startLine > totalLines + 1) {
    throw new Error(`edit ${editNumber}: startLine ${startLine} exceeds file length ${totalLines}`);
  }
  if (endLine > totalLines) {
    throw new Error(`edit ${editNumber}: endLine ${endLine} exceeds file length ${totalLines}`);
  }

  const deleteCount = endLine - startLine + 1; // 0 when endLine = startLine - 1 (insert)
  const newSlice = edit.newText.length === 0 ? [] : edit.newText.split(eol);
  // If newText ends with EOL, split produces a trailing empty element — drop it
  // so we don't introduce a blank line in the splice.
  if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
    newSlice.pop();
  }
  lines.splice(startLine - 1, deleteCount, ...newSlice);

  const joined = lines.join(eol);
  return trailingEol && joined.length > 0 ? joined + eol : joined;
}

function detectEol(s: string): string {
  return s.includes("\r\n") ? "\r\n" : "\n";
}

function findOccurrences(text: string, needle: string): number[] {
  const out: number[] = [];
  let index = text.indexOf(needle);
  while (index !== -1) {
    out.push(index);
    index = text.indexOf(needle, index + needle.length);
  }
  return out;
}

function byteOffsetToLine(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 0x0a) line++;
  }
  return line;
}
