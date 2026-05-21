---
name: semantic_search
category: read
requires_approval: false
---

## Purpose
Semantic code search — return the top-k indexed chunks ranked by
embedding similarity to a free-text query.

## When regex isn't enough
Use `semantic_search` when the question is conceptual — "where is the
retry logic," "code that parses LSP framing," "the place that handles
mid-batch cancellation." Regex `search` requires you to know what
tokens to look for; semantic ranking finds the right region even when
the wording differs.

## When to use
- Open-ended "find me code that does X" queries.
- Initial scoping in a large unfamiliar workspace where you don't yet
  know the naming conventions.
- After `search` returns too many noisy hits — re-issue the same intent
  as natural-language and re-rank by relevance.

## When NOT to use
- You know an exact identifier — `find_symbol` / `find_references` are
  faster and more precise.
- You need every match (e.g. for a rename) — semantic search returns
  the top-k, not exhaustive matches.
- The embedder isn't configured (`LOOM_EMBED_PROVIDER` unset) — the
  tool isn't registered in that case, so the model won't see it.

## Input
- `query` (string, required) — natural-language description of the code
  you're looking for. Be concrete: "code that handles retry with
  exponential backoff" beats "retry logic."
- `topK` (number, optional) — how many ranked chunks to return.
  Default keeps the result small; raise only if the first batch
  underwhelms.

## Behavior
- Returns ranked code chunks with their path and approximate line range.
- Quality depends on the index freshness. If the workspace just changed
  significantly, recent edits may not be re-embedded yet.
- Follow up with a narrow `read_file` slice on the most promising chunk
  — don't read the whole file.

## Examples

```json
{"query": "JSON-RPC framing with LSP-style Content-Length headers"}
```

Locate the wire-protocol codec without needing to know the file name.

```json
{"query": "summarize old messages when input tokens exceed threshold", "topK": 5}
```

Find the compaction policy by intent rather than function name.
