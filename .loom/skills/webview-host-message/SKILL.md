---
id: webview-host-message
synopsis: add a HostToWebview or WebviewToHost message and wire it through ChatPanel
triggers: [webview, ChatPanel, postMessage, HostToWebview, WebviewToHost, CSP, theme, markdown, transcript]
---

The webview (`webview-ui/`) is a Vite React app rendered inside a VS Code
webview panel. It talks to the extension host (`src/panel/ChatPanel.ts`) via
`postMessage` only — no shared memory, no direct LLM calls, no file system
access.

## Wire it through three layers

1. **Type the message** in `src/shared/protocol.ts`:
   - `HostToWebview` — host → webview push (e.g. `themeConfig`, `firstRunState`,
     a streamed token).
   - `WebviewToHost` — webview → host (user input, button click, settings
     update).
   - Use discriminated unions on `type:` so the switch in the receiver is
     exhaustive.

2. **Host side** (`src/panel/ChatPanel.ts`):
   - To send: `this.panel.webview.postMessage({ type: "...", ... })`.
   - To receive: extend the `onDidReceiveMessage` handler. Persist anything
     that should survive a reload via `workspaceState` / `globalState` /
     `SecretStorage`, depending on scope and sensitivity.

3. **Webview side** (`webview-ui/src/`):
   - `vscode.postMessage(...)` to send.
   - `window.addEventListener("message", e => ...)` to receive. The shared
     hook lives near `App.tsx`; reuse it instead of adding listeners.

## CSP constraints

The webview has a strict Content-Security-Policy:
- No inline `<script>` — every script must be bundled by Vite.
- No remote script sources (no CDN-loaded libraries).
- Inline event handlers (`onclick=`) are silently rejected; use React
  handlers.

## Theming

The webview is **data-attribute driven**:
- `loom.ui.accent`, `loom.ui.density`, `loom.ui.themeBias` flow as a
  `themeConfig` `HostToWebview` message.
- The webview applies them as `data-accent` / `data-density` / `data-theme`
  on the root element; CSS tokens in `webview-ui/src/styles/tokens.css`
  cascade from there.
- VS Code's own theme class (`.vscode-dark` / `.vscode-light`) handles
  base chrome. Loom owns accent + density only.

## Markdown / HTML rendering

Session state stores **raw assistant text**. The webview renders Markdown
without raw HTML. If you need a clickable code reference, use the
`openInEditor` flow:
- Webview posts `{ type: "openInEditor", id, title, content, language? }`.
- Host opens a read-only `loom-doc:` virtual document
  (`src/tools/openInEditor.ts`) via `vscode.workspace.openTextDocument`.

## Transcript discipline

Every tool call renders through one uniform `ToolCardMinimal`. Do not
introduce per-tool specialty body components. The card must reserve its
full height inside the scrollable transcript (`flex-shrink: 0`) so
expanded panes are never clipped behind the composer. Auto-follow uses a
ResizeObserver, not a length effect — do not change that to keying on
`[messages, pendingOutputs]`.

## Shutdown

`ChatPanel.dispose()` cancels active tasks, persists session state, clears
pending approvals, and disposes `AgentClient`. If your new message holds
resources (subscriptions, timers, open editors), register cleanup in
`dispose()` — VS Code process cleanup is not a reliable fallback for
update/reload behavior.
