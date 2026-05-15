import { createTwoFilesPatch } from "diff";

export function createUnifiedDiff(relPath: string, before: string, after: string): string {
  return createTwoFilesPatch(relPath, relPath, before, after, "", "");
}
