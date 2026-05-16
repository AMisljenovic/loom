---
id: typescript-strict
synopsis: TypeScript patterns for strict mode used across the repo
triggers: [typescript, tsc, strict, unknown, any, generics, narrowing]
---

This project uses `tsc --strict`. Conventions that follow from that:

- **Prefer `unknown` over `any`.** When you cannot type something precisely
  (untyped JSON, dynamic plugin output), use `unknown` and narrow with a
  type guard before use. `any` defeats the type checker and is reserved for
  unavoidable interop.
- **Narrowing with type guards.** Write small predicates like
  `function isFoo(x: unknown): x is Foo { return ... }` and let TS narrow.
  Avoid `as Foo` casts unless you can justify the assertion in a comment.
- **Discriminated unions for variants.** Modelling
  `{ kind: "ok"; value: T } | { kind: "err"; error: E }` produces better
  errors than nullable fields with implicit invariants.
- **No `enum`.** Use `as const` literal unions:
  `type Mode = "code" | "ask" | "architect" | "debug";`.
- **Imports use the `node:` prefix for Node built-ins** (`node:path`, not
  `path`). This matches the runtime and avoids ambient module conflicts.
- **Promises and `await`.** No `.then()` chains; always `await`. If you do
  not await, mark the call `void promise` so the lint flags genuine misses.
- **Optional fields.** Prefer `name?: string` over `name: string | undefined`
  for object shapes that may omit the property entirely.
- **Generics only with a need.** Don't add a type parameter "for
  flexibility" — only when callers actually vary the type.
- **Module structure.** Multiple named exports per file; no default exports
  for modules with more than one export.

When TS errors look mysterious, run `tsc --noEmit` directly and read the
exact diagnostic — the editor sometimes shows a derived form that hides the
root cause.
