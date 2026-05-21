export interface DiffLineCounts {
  added: number;
  removed: number;
}

export function parseDiffStats(unified: string): DiffLineCounts {
  let added = 0;
  let removed = 0;
  const lines = unified.split("\n");
  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("@@")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

export interface FileDiffStat {
  path: string;
  added: number;
  removed: number;
  unified: string;
}

export interface AggregatedFileStat {
  path: string;
  added: number;
  removed: number;
  latestCallId: string;
}

export function aggregateDiffStats(stats: ReadonlyMap<string, FileDiffStat>): {
  files: AggregatedFileStat[];
  totalAdded: number;
  totalRemoved: number;
} {
  const byPath = new Map<string, AggregatedFileStat>();
  let totalAdded = 0;
  let totalRemoved = 0;
  for (const [callId, stat] of stats) {
    totalAdded += stat.added;
    totalRemoved += stat.removed;
    const existing = byPath.get(stat.path);
    if (existing) {
      existing.added += stat.added;
      existing.removed += stat.removed;
      existing.latestCallId = callId;
    } else {
      byPath.set(stat.path, {
        path: stat.path,
        added: stat.added,
        removed: stat.removed,
        latestCallId: callId,
      });
    }
  }
  return { files: Array.from(byPath.values()), totalAdded, totalRemoved };
}
