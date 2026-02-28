# Stack Research — Server A → D Integration

**Project:** add-jipi (Server A adaptation)
**Dimension:** Technology Stack
**Date:** 2026-02-28
**Confidence:** HIGH

---

## Summary

Zero new dependencies required. Every pattern needed for D client integration already exists in the codebase. The path forward is to extract shared utilities, clone existing patterns, and add environment-variable-gated stub mode.

---

## HTTP Client

**Recommendation:** Native `fetch` (already in use)

The broker-client already uses native fetch with `executeBoundedDependency`. Clone this exact pattern for the D client. No new library needed.

| Aspect | Decision | Confidence |
|--------|----------|------------|
| HTTP client | Native fetch | HIGH |
| Retry/timeout wrapper | Existing `executeBoundedDependency` | HIGH |
| Retry strategy | Existing jitter-backoff (already tested) | HIGH |

**D client timeouts (tighter than broker):**
- Attempt timeout: 10s (broker uses 60s — D is local infrastructure, not external)
- Total budget: 15s
- Retries: 1 (same as broker)

---

## Stub / Unavailable Service Pattern

**Recommendation:** Empty `D_BASE_URL` env var → stub mode

Mirrors the existing Redis optional-availability pattern exactly. When `D_BASE_URL` is unset, the D client returns a structured error or degrades gracefully. No D_BASE_URL = stub mode. This keeps A functional while D is being built.

```js
// Same pattern as Redis client
if (!process.env.D_BASE_URL) {
  return { ok: false, code: 'D_NOT_CONFIGURED' };
}
```

**Confidence:** HIGH — direct pattern match to existing codebase convention.

---

## Shared Utility Extraction

**Recommendation:** Extract `executeBoundedDependency` before adding D client

Currently `executeBoundedDependency` is duplicated in `broker-client.js` and `redis-client.js`. Adding a third copy in `d-client.js` creates triple duplication. Extract to `modules/integrations/bounded-dependency.js` first.

**Risk:** LOW — pure refactor with no behavior change. Existing callers updated to import from shared module.

---

## User-Agent Forwarding

**Recommendation:** Fire-and-forget POST to D, never block main request

UA forwarding is a side channel. Send as background async with `Promise.resolve().then(...)` — no await, no error propagation to caller. If D is unavailable, UA is simply not forwarded (acceptable loss).

**Confidence:** HIGH — trivial header passthrough.

---

## Failure Log Shipping (Nightly)

**Recommendation:** Operator route + Vercel Cron trigger

Vercel serverless has no process shutdown hooks. The nightly log ship needs to be triggered externally. Two options:

1. **Vercel Cron** (`vercel.json` crons block) — hits a dedicated `POST /operator/ship-logs` route during the shutdown window
2. **External cron** — any scheduler (GitHub Actions schedule, etc.) calls the same route

The route itself: reads quarantine events from Redis, POSTs them to D's log collection endpoint, clears the local list on success.

**Confidence:** MEDIUM — pattern is sound; Vercel Cron tier availability and exact config syntax needs verification at implementation time.

---

## What NOT to Use

| Thing | Why Not |
|-------|---------|
| axios / got / node-fetch | Native fetch already works, no new deps |
| p-retry / async-retry | `executeBoundedDependency` already covers this |
| External scheduler service | Adds dependency; Vercel Cron or GitHub Actions are free |
| Process `exit` hooks | Don't exist in serverless — use route + cron |

---

## Suggested Build Order

1. **Extract shared utilities** — `bounded-dependency.js`, `isTransientDependencyFailure` into shared module
2. **Build D client** — `modules/integrations/d-client.js`, stub mode when D_BASE_URL unset
3. **Wire D client into stream handler** — replace broker-client calls, use title from D response
4. **Add UA forwarding** — fire-and-forget side channel in stream handler
5. **Add log shipping route** — `POST /operator/ship-logs` + Vercel Cron config

---

## Open Questions

- Exact Vercel Cron `vercel.json` syntax (verify at implementation time — changes between Vercel versions)
- D's HTTP-level contract (path, method, error shape) — needs to be defined before wiring
- Whether to fall back to direct broker call in stub mode, or return degraded response
