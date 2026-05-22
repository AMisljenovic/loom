# Monorepo Rules

- Identify the package or app affected by the request before editing.
- Prefer package-local scripts over root scripts when both exist.
- Do not change shared packages unless the task requires it and the caller can
  see the impact.
- When touching a shared API, update all in-repo consumers in the same change.
- Mention which package-level tests or builds were run.
