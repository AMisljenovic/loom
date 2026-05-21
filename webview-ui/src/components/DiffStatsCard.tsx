import { useMemo, useState } from "react";
import { aggregateDiffStats, type FileDiffStat } from "../util/diffStats";
import { post } from "../vscode";

interface DiffStatsCardProps {
  stats: ReadonlyMap<string, FileDiffStat>;
  busy: boolean;
  onKeep: () => void;
  onUndo: () => void;
}

export function DiffStatsCard({ stats, busy, onKeep, onUndo }: DiffStatsCardProps) {
  const [expanded, setExpanded] = useState(false);
  const aggregate = useMemo(() => aggregateDiffStats(stats), [stats]);

  if (aggregate.files.length === 0) return null;

  const fileCount = aggregate.files.length;
  const showActions = !busy;

  const openFile = (file: { path: string; latestCallId: string }) => {
    const stat = stats.get(file.latestCallId);
    if (!stat) return;
    post({
      type: "openInEditor",
      id: `diff-stats:${file.latestCallId}`,
      title: `Diff: ${file.path}`,
      content: stat.unified,
      language: "diff",
    });
  };

  const handleUndo = () => {
    const fileList = aggregate.files.map((f) => f.path).join("\n  ");
    const message = fileCount === 1
      ? `Undo changes to ${aggregate.files[0].path}? This restores the file to its state before this turn.`
      : `Undo changes to ${fileCount} files? This restores them to their state before this turn.\n\n  ${fileList}`;
    if (window.confirm(message)) {
      onUndo();
    }
  };

  return (
    <div className="diff-stats-card" data-expanded={expanded || undefined}>
      <div className="diff-stats-header">
        <button
          type="button"
          className="diff-stats-summary"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          title={expanded ? "Hide changed files" : "Show changed files"}
        >
          <span className="diff-stats-chevron" aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
          <span className="diff-stats-label">
            {fileCount === 1 ? "1 file changed" : `${fileCount} files changed`}
          </span>
          <span className="diff-stats-added">+{aggregate.totalAdded}</span>
          <span className="diff-stats-removed">-{aggregate.totalRemoved}</span>
        </button>
        {showActions && (
          <div className="diff-stats-actions">
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleUndo}
              title="Restore all changed files to their state before this turn"
            >
              Undo
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={onKeep}
              title="Dismiss this summary (changes are already saved)"
            >
              Keep
            </button>
          </div>
        )}
      </div>
      {expanded && (
        <ul className="diff-stats-files">
          {aggregate.files.map((file) => (
            <li key={file.path} className="diff-stats-file">
              <button
                type="button"
                className="diff-stats-file-btn"
                onClick={() => openFile(file)}
                title={`Open diff for ${file.path}`}
              >
                <span className="diff-stats-file-path">{file.path}</span>
                <span className="diff-stats-added">+{file.added}</span>
                <span className="diff-stats-removed">-{file.removed}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
