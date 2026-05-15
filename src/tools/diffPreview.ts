import * as vscode from "vscode";

const SCHEME = "loom-diff";

interface DiffPreviewEntry {
  relPath: string;
  before: string;
  after: string;
}

const previews = new Map<string, DiffPreviewEntry>();

export function registerApplyDiffContentProvider(context: vscode.ExtensionContext) {
  const provider = new ApplyDiffContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider)
  );
}

export function setDiffPreview(callId: string, relPath: string, before: string, after: string) {
  previews.set(callId, { relPath, before, after });
}

export function clearDiffPreview(callId: string) {
  previews.delete(callId);
}

export async function openDiffPreview(callId: string, relPath: string) {
  const beforeUri = makePreviewUri(callId, relPath, "before");
  const afterUri = makePreviewUri(callId, relPath, "after");
  await vscode.commands.executeCommand(
    "vscode.diff",
    beforeUri,
    afterUri,
    `${relPath} (proposed)`
  );
}

export async function closeDiffPreview(callId: string) {
  const beforeUri = makePreviewUri(callId, "", "before").toString();
  const afterUri = makePreviewUri(callId, "", "after").toString();
  const tabs: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (!(tab.input instanceof vscode.TabInputTextDiff)) continue;
      if (
        tab.input.original.toString().startsWith(beforeUri) ||
        tab.input.modified.toString().startsWith(afterUri)
      ) {
        tabs.push(tab);
      }
    }
  }
  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs);
  }
}

class ApplyDiffContentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    const callId = uri.authority;
    const side = uri.path.split("/")[1];
    const entry = previews.get(callId);
    if (!entry) return "";
    return side === "before" ? entry.before : entry.after;
  }
}

function makePreviewUri(callId: string, relPath: string, side: "before" | "after"): vscode.Uri {
  return vscode.Uri.from({
    scheme: SCHEME,
    authority: callId,
    path: `/${side}/${encodePath(relPath)}`,
  });
}

function encodePath(relPath: string): string {
  return relPath.split(/[\\/]/).map(encodeURIComponent).join("/");
}
