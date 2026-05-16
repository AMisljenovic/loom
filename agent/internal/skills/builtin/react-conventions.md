---
id: react-conventions
synopsis: function-component React patterns used in the Loom webview
triggers: [react, tsx, jsx, webview, hooks, component]
---

When writing or editing React code (most of which lives in `webview-ui/`):

- **Function components only.** No class components, no `React.Component`
  subclasses. Stick with the modern `function Foo(props: FooProps)` form.
- **Hooks for state.** `useState` for simple local state; `useReducer` when
  state transitions are non-trivial. Avoid pulling in Redux / Zustand /
  context-as-state-store — this project is intentionally small.
- **One component per file** when the component is non-trivial. For tightly
  coupled helper components, co-locating is fine.
- **No default exports** when a module exports multiple symbols. Named
  exports keep imports searchable.
- **Inline styles use VS Code CSS variables** (`var(--vscode-font-family)`,
  `var(--vscode-editor-background)`, etc.) so the UI matches the user's
  theme. Avoid hard-coded colours unless the design tokens in
  `webview-ui/src/styles/tokens.css` already pick them up.
- **Effects close over current props.** When an effect reads props or state,
  list them in the dependency array. Disable the lint rule only with a
  specific reason in a comment.
- **Webview ↔ extension communication is `postMessage` only.** Components
  do not call `vscode.*` APIs directly. Send a typed message and let
  `src/panel/ChatPanel.ts` handle it.
- **No raw HTML rendering.** The chat renders Markdown safely without
  `dangerouslySetInnerHTML`; do not introduce it.

When a UI change is requested, start by reading the related component plus
its parent (state usually lives one level up).
