---
id: vscode-api
synopsis: common pitfalls when calling VS Code APIs from the extension host
---

Key VS Code API conventions you should respect:

- **`vscode.Uri`**: never construct from a string with `vscode.Uri.parse` for
  filesystem paths. Use `vscode.Uri.file(absolutePath)` so backslashes on
  Windows are handled correctly.
- **`workspace.applyEdit`**: after an edit, call `doc.save()` to flush to
  disk. Without save, the edit lives only in the editor buffer.
- **`getDiagnostics`**: pull-only. Language servers populate diagnostics
  asynchronously; if you fetch immediately after an edit, the result may be
  stale. Wait ~750ms or react to `onDidChangeDiagnostics`.
- **Webview CSP**: the extension's webview has a strict Content-Security-Policy.
  All scripts must be bundled (Vite/webpack); inline `<script>` tags are
  rejected silently.
- **`workspace.workspaceFolders`**: may be empty. Always null-check before
  indexing `[0]`.
- **Disposables**: every event subscription returns a `Disposable`. Push it
  into `context.subscriptions` so VS Code cleans it up on reload.
