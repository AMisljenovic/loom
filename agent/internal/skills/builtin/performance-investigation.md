---
id: performance-investigation
synopsis: how to approach a performance problem methodically
triggers: [perf, performance, slow, profile, latency, throughput, optimize]
---

Performance work is empirical. Treat it like debugging:

- **Measure first.** Before changing anything, capture a baseline. Wall
  time, CPU, memory, allocations, or whatever metric matches the symptom.
  Without a number, you cannot tell whether a change helped.
- **Reproduce the symptom.** A perf bug that only shows up "sometimes in
  production" is unanswerable. Build a repro — synthetic load, a real
  failing trace, or a narrowed test case.
- **Profile, don't guess.** Use `pprof` (Go), the Chrome dev tools (TS),
  or the language's standard profiler. Find the actual hot path; don't
  optimise what you remember being slow last quarter.
- **Form a hypothesis from data.** "This function is O(n²) and n grew" is
  a hypothesis. "Maybe garbage collection?" is not — until you measure GC
  pauses.
- **Change one thing at a time.** If you batch four changes and the
  benchmark improves, you do not know which change mattered. Re-running a
  benchmark per change costs little next to debugging a regression later.
- **Verify with the original metric.** Re-measure the same way you
  measured the baseline. A change that made one path faster while making
  another slower is still a regression.
- **Cheap and correct beats clever.** Caches, indexes, batching, and
  avoiding redundant work are usually the right tools. Reach for
  hand-rolled SIMD or unsafe pointer math only when the boring options
  are demonstrably exhausted.
- **Set a budget.** "Faster" is open-ended. "Under 200ms p95" is a target
  you can stop at.
- **Document the constraint.** When you've optimised something, leave a
  comment explaining the invariant the optimisation relies on, so a future
  refactor doesn't silently undo it.

Common traps: micro-benchmarking inside a single process and extrapolating;
optimising for the average when the tail matters; conflating throughput
with latency.
