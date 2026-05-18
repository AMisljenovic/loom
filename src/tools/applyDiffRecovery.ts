export function recoverableApplyDiffError(path: string, editNumber: number, reason: string): string {
  return [
    `edit ${editNumber}: ${reason}`,
    "Recovery: call read_file for the same path, then call apply_diff once with oldText set to the full current file contents and newText set to the full desired file contents.",
    `Path: ${path}`,
  ].join("\n");
}
