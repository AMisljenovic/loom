# Strict Test Rules

- For bug fixes, add or update a failing test before changing implementation
  when the test surface exists.
- For new behavior, include tests for the normal path and at least one failure
  or edge case.
- Do not remove assertions to make a test pass.
- If tests cannot be run locally, state the exact command that should be run and
  why it was not run.
