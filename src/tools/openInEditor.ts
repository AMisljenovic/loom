import * as vscode from "vscode";

const SCHEME = "loom-doc";

interface DocEntry {
  content: string;
  language?: string;
}

const docs = new Map<string, DocEntry>();
const onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();

export function registerOpenInEditor(context: vscode.ExtensionContext) {
  const provider = new LoomDocContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    onDidChangeEmitter,
  );
}

export async function openVirtualDoc(
  id: string,
  title: string,
  content: string,
  language?: string,
) {
  docs.set(id, { content, language });
  const uri = makeDocUri(id, title);
  onDidChangeEmitter.fire(uri);
  const doc = await vscode.workspace.openTextDocument(uri);
  if (language) {
    try {
      await vscode.languages.setTextDocumentLanguage(doc, language);
    } catch {
      // unknown language id — VS Code keeps the default
    }
  }
  await vscode.window.showTextDocument(doc, { preview: true });
}

function makeDocUri(id: string, title: string): vscode.Uri {
  const safeTitle = sanitizeTitle(title);
  return vscode.Uri.from({
    scheme: SCHEME,
    path: `/${safeTitle}`,
    query: `id=${encodeURIComponent(id)}`,
  });
}

function sanitizeTitle(title: string): string {
  const trimmed = title.replace(/[\\/:*?"<>|]+/g, "_").trim();
  return trimmed.length > 0 ? trimmed : "loom-doc";
}

class LoomDocContentProvider implements vscode.TextDocumentContentProvider {
  readonly onDidChange = onDidChangeEmitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    const id = idFromQuery(uri.query);
    if (!id) return "";
    return docs.get(id)?.content ?? "";
  }
}

function idFromQuery(query: string): string {
  for (const part of query.split("&")) {
    const [k, v] = part.split("=");
    if (k === "id" && v !== undefined) {
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return "";
}
