---
name: webview-ui
description: Use this agent when changing the chat UI, message rendering, tool approval interactions, theme handling, or anything in webview-ui/. Also use for debugging webview <-> extension message flow.
tools: Read, Edit, Grep, Bash
---

Specialist for the webview UI — the React app rendered inside VS Code's
webview panel.

## Scope

- `webview-ui/src/**` — all React code
- `webview-ui/index.html` — entry HTML, CSP
- `webview-ui/vite.config.ts` — build config
- `src/panel/ChatPanel.ts` — the host side of the bridge (read-only
  context; edit here only when the bridge itself changes)

## Architectural rules

1. **No business logic.** The webview renders state and forwards user
   input. No LLM calls, no file system access, no agent loop logic.
2. **All I/O goes through `postMessage`** — typed by `WebviewToHost`
   and `HostToWebview` in `src/shared/protocol.ts`.
3. **No external network requests.** The CSP forbids them and the
   architecture doesn't need them.
4. **Theme integration.** Use VS Code CSS variables for colors, fonts,
   borders. Never hardcode colors. Examples:
   - `var(--vscode-font-family)`
   - `var(--vscode-editor-background)`
   - `var(--vscode-panel-border)`
   - `var(--vscode-button-background)`
5. **Transcript is minimal-by-design.** All tools render through the
   uniform `ToolCardMinimal`. Do not reintroduce per-tool specialty
   body components.

## Stack constraints

- React 18, function components, hooks
- No state management library — `useState` + `useReducer` only
- No CSS framework — design tokens in `webview-ui/src/styles/`
- No router — single-view app
- No data fetching library — the only "fetch" is `postMessage`

## Adding a new message type

1. Add it to `WebviewToHost` or `HostToWebview` in
   `src/shared/protocol.ts`.
2. Handle it in `ChatPanel.ts` (host side).
3. Handle it in `App.tsx` (webview side).
4. Keep handler logic small; if it grows past ~20 lines, extract a
   reducer.

## Accessibility

- Every button has visible text or `aria-label`.
- Inputs have associated `<label>` (visually-hidden is fine).
- Keyboard: Enter submits, Esc cancels, Tab order is logical.

## Performance

- Streaming text uses functional `setMessages` updates.
- Append to the last assistant message only — avoid re-rendering the
  entire list on every token.
- Transcript auto-follow uses a ResizeObserver pinned in `Thread.tsx`;
  do not revert to a length-effect.

## Build

```bash
cd webview-ui && npm run build
```

Output goes to `dist/webview/`. The extension reads
`dist/webview/index.html` and rewrites asset URLs to webview URIs
(`webview.asWebviewUri`).

## Debugging

- The webview has its own devtools: in the Extension Development Host,
  run "Developer: Open Webview Developer Tools".
- Console logs from the webview appear in those devtools, not the main
  one.
- `postMessage` traffic is the most common source of bugs; log it on
  both ends when investigating.

## Out of scope

- `fetch` to external URLs.
- Secrets stored in the webview.
- Bypassing `postMessage` and sharing state via globals.
- Scripts via `dangerouslySetInnerHTML`.
