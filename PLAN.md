# Plan: Speed up stremio/plugin.js HTTP fan-out (parallel, bounded, reliable)

> STATUS: COMPLETE — all milestones verified. Harness: 26/26 PASS
> (`node /tmp/opencode/stremio-hub-test/harness.mjs`).

## Bottleneck audit (found by reading stremio/plugin.js)

1. **search(): fake concurrency limit (critical)** — tasks are created as
   `p: fetchJson(...)` which STARTS the request immediately; `pLimit(12)` only
   wraps already-running promises, so it gates nothing. Up to ~300 requests fire
   at once. Filter-batch requests all start even when never awaited (native
   hits >= 20) — pure waste.
2. **load(): serial meta fallback chain (critical)** — primary meta → blind
   600ms delay + retry → sibling addons fetched ONE BY ONE → cinemeta bases and
   types nested ONE BY ONE. Worst case 10+ sequential round trips.
3. **getHome(): unbounded fan-out** — up to MAX_CATALOGS_PER_ADDON(30) x ~30
   addons = ~900 simultaneous catalog GETs.
4. **fetchJson(): retry wastes budget** — full second timeout after fixed 400ms;
   getAddons worst case ~62s+, nearly all of GUARD_BUDGET_MS.
5. **getAddons() all-failed retry refetches URLs that already succeeded**
   (second pass ignores cache).
6. **No single-flight dedupe** — concurrent entry calls re-fetch identical URLs.
7. **pLimit() leaks a slot if fn rejects** (decrement only on fulfill).
8. **No negative cache** — a dead addon re-stalls every screen for its full
   timeout.

## Milestone 1: HTTP core (in plugin.js, keep ES5-ish style + async/await)

- [x] `pool(items, n, fn)`: bounded-concurrency parallel map, order-preserving,
      slot released on fulfill AND reject.
- [x] Fix `pLimit` decrement-on-reject (keep for compat).
- [x] `httpJson`: single-flight in-flight dedupe per URL (share one promise).
- [x] `fetchJson(url, timeoutMs, retries)`: budget-split attempts (60% / 60% of
      T) with tiny jittered backoff — total stays ~1.2T max.
- [x] Negative-result micro-cache (CFG.NEG_TTL_MS = 30s).
- Verify: node harness unit tests pass (see M3 commands).

## Milestone 2: Entry points onto the new core

- [x] `getAddons`: pool(10); failed-only second pass; negative cache.
- [x] `getHome`: build LAZY job list, cap CFG.MAX_HOME_JOBS=140, pool(12).
- [x] `search`: lazy task factories; slice BEFORE starting; pool(12); filter
      batch only started if needed.
- [x] `load`: stage 1 = own-addon meta AND cinemeta (tt ids) in parallel; stage
      2 = siblings via pool in parallel; remove blind delay(600).
- [x] `loadStreams`: keep per-addon deadlines; explicit subJob await (drop
      index-magic `idx === jobs.length - 1`).
- Verify: node harness integration tests pass.

## Milestone 3: Prove it

- [x] Harness: /tmp/opencode/stremio-hub-test/harness.mjs stubs global
      http_get/manifest/_dartAsyncCall with simulated latency; asserts
      correctness + observed concurrency caps + wall-clock speedups vs old file
      (kept at /tmp/opencode/stremio-hub-test/plugin.old.js).
- Command: `node /tmp/opencode/stremio-hub-test/harness.mjs` Expected: all PASS
  lines, 0 failures, search/home wall-clock clearly lower.
- [x] ast-lens complexity sanity on modified file.
- [x] Report diff summary; remind user to REVOKE the leaked GitHub token.

## Constraints

- Public API unchanged: getHome/search/load/loadStreams/getSettings.
- Style: var/function, no optional chaining/spread (embedded JS engine).
- No new dependencies; host contract (http_get, manifest, _dartAsyncCall)
  untouched.
