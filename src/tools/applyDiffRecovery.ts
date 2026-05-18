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
