import React from "react";

export function InlineDiff({ unified }: { unified: string }) {
  return (
    <pre style={styles.diff}>
      {unified.split("\n").map((line, index) => (
        <div key={index} style={{ ...styles.line, ...styleForLine(line) }}>
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

function styleForLine(line: string): React.CSSProperties {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return styles.inserted;
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return styles.removed;
  }
  if (line.startsWith("@")) {
    return styles.hunk;
  }
  return {};
}

const styles: Record<string, React.CSSProperties> = {
  diff: {
    margin: 0,
    maxHeight: 320,
    overflow: "auto",
    border: "1px solid var(--vscode-panel-border)",
    background: "var(--vscode-editor-background)",
    color: "var(--vscode-editor-foreground)",
    fontFamily: "var(--vscode-editor-font-family)",
    fontSize: "var(--vscode-editor-font-size)",
    lineHeight: 1.45,
    whiteSpace: "pre",
  },
  line: {
    minHeight: "1.45em",
    padding: "0 8px",
  },
  inserted: {
    background: "var(--vscode-diffEditor-insertedTextBackground)",
  },
  removed: {
    background: "var(--vscode-diffEditor-removedTextBackground)",
  },
  hunk: {
    color: "var(--vscode-editorLineNumber-foreground)",
  },
};
