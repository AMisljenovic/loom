export function recoverableApplyDiffError(
  path: string,
  editNumber: number,
  reason: string,
  matchLines?: number[],
): string {
  const lines = [`edit ${editNumber}: ${reason}`];
  if (matchLines && matchLines.length > 0) {
    lines.push(`Matches at lines: ${matchLines.join(", ")}.`);
  }
  lines.push(
    "Recovery: use `search` to locate the exact lines, then call `apply_diff` with a range edit {startLine, endLine, newText} for just the changed slice. Do not re-emit the whole file.",
    `Path: ${path}`,
  );
  return lines.join("\n");
}

// Schema-error recovery for newText type mismatches. Reports the actual
// JS type the model passed so the next attempt can correct it directly,
// then teaches the canonical string shape (multiline via literal "\n",
// empty string for delete). Mirrors the recoverableApplyDiffError shape
// so the model sees one consistent recovery contract for apply_diff.
export function recoverableNewTextTypeError(editNumber: number, actual: unknown): string {
  return [
    `edit ${editNumber}: newText must be a string (got ${describeType(actual)})`,
    "Recovery: pass `newText` as a JSON string. For multiline content, use literal \\n between lines (e.g. \"line1\\nline2\"). To delete, pass an empty string \"\".",
  ].join("\n");
}

function describeType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
