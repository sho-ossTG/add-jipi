# Server A — add-jipi

## What This Is

Server A is a Stremio addon (Node.js, serverless on Vercel) that serves as the client-facing entry point for a multi-server streaming link resolution system. Users request episodes by IMDB ID + season + episode; A returns a playable stream link with the episode title. As of v1.0, A routes all resolution through Server D (central data middleware) — A is intentionally thin: receive request → call D → return result. UA forwarding and nightly failure log shipping to D are wired as side channels.

## Core Value

Users get a stream link with the correct episode title — A delegates all lookup and enrichment to D and trusts what it gets back.

## Requirements

### Validated

- ✓ Time window policy (08:00–00:00 Jerusalem time) — existing
- ✓ Session capacity gate (max concurrent sessions via Redis Lua) — existing
- ✓ Stream request handling (episode resolution from URL) — existing
- ✓ Operator routes (/health, /metrics, /analytics, /quarantine) — existing
- ✓ Hourly analytics tracking (Redis) — existing
- ✓ Session view tracking (Redis) — existing
- ✓ CORS, request correlation, observability — existing
- ✓ Stremio addon protocol (manifest, catalog, stream handlers) — existing
- ✓ Degradation policy (graceful fallback on resolution failure) — existing
- ✓ Replace broker client with D client — v1.0 (stream-route + addon wired to createDClient)
- ✓ Remove local title extraction — v1.0 (cleanTitle/resolveBrokerFilename deleted; D title used verbatim)
- ✓ Forward User-Agent to D — v1.0 (fire-and-forget with warn observability + ua_forward_error counter)
- ✓ Define D client interface — v1.0 (contract-documented in d-client.js with executable tests)
- ✓ Wire four unwired test files into npm gate — v1.0 (PRE-1)
- ✓ Fix nightly rollup bugs — v1.0 (shutdown analytics gap, HLL tracking, daily unique count)
- ✓ Delete broker-client.js and complete D-only telemetry taxonomy — v1.0 (with regression guard)
- ✓ Operator /logs/pending pull endpoints — v1.0 (GET/DELETE day-scoped with auth boundary)

### Active (v2.0)

- [ ] Wire `shipFailureLogs` into nightly rollup path — `operator-routes.js` + `request-controls.js`; non-destructive LRANGE; warn on failure (FR-5)
- [ ] Consolidate `executeBoundedDependency` to single definition — remove local wrapper in `redis-client.js` and inlined copy in `http-handler.js` (PRE-3)
- [ ] Remove broker-source fallback normalization from `observability/metrics.js:58` and lock with contract coverage (FR-3/metrics)

### Out of Scope

- Offloading hourly analytics or session tracking to D — stays in A's Redis layer
- Building Server B, C, or D — separate projects
- Changes to policy gates, session management, or operator authentication — not part of this adaptation
- Mobile or non-Stremio clients — web/addon only
- Vercel Cron configuration for automated nightly trigger — manual operator route is sufficient

## Context

**Current state (v1.0):** D client is live in stream resolution path. `broker-client.js` is deleted. UA is forwarded fire-and-forget on each successful resolution. Operator pull endpoints for pending logs exist. Three cleanup items deferred to v2 (see Active requirements).

**Tech stack:** Node.js, CommonJS, Vercel serverless, pino, Upstash Redis, Stremio SDK. No new dependencies added in v1.0.

**Known technical debt:**
- `http-handler.js:86-141` — inlined `executeBoundedDependency` copy (same algorithm, different constants)
- `observability/metrics.js:58` — broker-source fallback normalization branch (silent masking, not a crash)
- `redis-client.js:9` — local wrapper around shared `executeBoundedDependency`

## Constraints

- **Tech Stack**: Node.js, CommonJS, Vercel serverless — no new frameworks or npm dependencies
- **D not yet confirmed in production**: D client degrades gracefully when D is unreachable (dependency_unavailable → degraded stream payload)
- **Existing policy gates untouched**: Time window, session gate, operator auth — no changes
- **Stremio protocol compliance**: Stream payload format must remain valid for Stremio clients

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| A routes through D, not B directly | D owns all data/cache/enrichment; A stays thin | ✓ Shipped v1.0 |
| D client stubbed until D is live | D not built yet; need A ready independently | ✓ Degrades cleanly |
| Local analytics stay in A | Not in scope for v1.0 | — Deferred |
| Episode title comes from D | D reads filename → A stops parsing URLs for titles | ✓ Shipped v1.0 |
| Broker call sites removed in Phase 2, file deleted in Phase 5 | Staged approach: confirm D works before deleting reference | ✓ Done |
| broker label kept in degradation policy keys through Phase 2 | Deferred cleanup to Phase 5 to reduce risk surface | ✓ Cleaned in Phase 5 |
| stats:broker_error → stats:d_error clean-cut, no migration shim | Redis counters are ephemeral; no migration needed | ✓ Done |
| UA forward uses injected onFailure callback, not integration-layer logger | Keeps routing as observer without coupling integration to logger | ✓ Shipped |
| FR-5 push wiring deferred to v2 | Phase 4 scope drifted to pull endpoints; accepted as tech debt | ⚠ Deferred v2 |
| PRE-3 sole-definition not achieved for http-handler Redis path | http-handler inlines its own copy; behavioral parity but contract violated | ⚠ Deferred v2 |
| broker normalization fallback in metrics.js deferred | Acknowledged survivor; silent mask, not a crash | ⚠ Deferred v2 |

---
*Last updated: 2026-03-03 after v1.0 milestone*
