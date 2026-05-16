---
id: error-handling
synopsis: language-agnostic error-handling patterns to follow in this repo
triggers: [error, exception, panic, recover, try, catch, fail]
---

Errors are part of the API. Treat them deliberately:

- **Don't swallow errors.** Silent `catch (e) {}` and `if err != nil {
  return nil }` are bugs in waiting. If you must ignore an error, leave a
  comment explaining why so reviewers know it's deliberate.
- **Wrap with context, don't replace.** When propagating, add information
  about *what* you were doing. Go: `fmt.Errorf("read config: %w", err)`.
  TypeScript: throw a new `Error("read config: " + (e as Error).message)`
  or use a cause-aware error class.
- **Don't log and return.** Pick one. Logging at every level produces
  duplicated noise; either handle the error or surface it. The top of the
  call stack logs once.
- **Distinguish expected from unexpected.** A user-facing `Error: file not
  found` is different from a `TypeError: cannot read property of
  undefined`. The former is a normal path; the latter is a bug. Don't blur
  them with a generic `try/catch`.
- **Fail loudly at boundaries.** Panic / throw on programmer errors (bad
  invariants, impossible states). Return errors for runtime conditions the
  caller can reasonably handle.
- **Resource cleanup belongs in `defer` / `finally`.** Don't rely on the
  happy path to release files, processes, locks, or timers.
- **Surface root causes to the user.** When an operation fails because of a
  downstream issue, the error message should help the user fix the
  downstream issue. "Operation failed" is not a useful message.
- **Test the error path.** A function with three error returns should have
  at least one test per error return. Errors are interface, not noise.

When debugging an opaque error, search for the literal message; if it's
generic, the wrapping is probably too thin — improve the message before
adding logging.
