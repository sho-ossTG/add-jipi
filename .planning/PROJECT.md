# Server A — D Integration Adaptation

## What This Is

Server A is a Stremio addon (Node.js, serverless on Vercel) that serves as the client-facing entry point for a 4-server streaming link resolution system. Users request episodes by IMDB ID + season + episode, and A returns a playable stream link with the episode title. This project adapts A to route all resolution requests through Server D (the central data middleware) instead of calling Server B directly.

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

### Active

- [ ] Replace broker client with D client — A sends (IMDB + season + episode) to D; receives (link + episode title) back
- [ ] Remove local title extraction — stop parsing filename from broker URL; use episode title field from D's response
- [ ] Forward User-Agent to D — send UA from each request to D for centralized storage (not just local Redis session view)
- [ ] Ship failure logs to D at night — during shutdown window, send accumulated failure events to D instead of only local rollup
- [ ] Define D client interface — establish the API contract A expects from D (since D is not built yet; stub until live)

### Out of Scope

- Offloading hourly analytics or session tracking to D — stays in A's Redis layer for now
- Building Server B, C, or D — separate projects
- Changes to policy gates, session management, or operator routes — not part of this adaptation
- Mobile or non-Stremio clients — web/addon only

## Context

A currently calls Server B (broker) directly via `modules/integrations/broker-client.js`. In the target architecture, A should only talk to D — D owns all DB writes, cache lookups, episode title enrichment, and B/C orchestration. A is intentionally kept thin: receive request → call D → return result.

Server D does not exist yet. The D client in A will be built against a defined interface contract and stubbed until D is live. The contract: A sends `{ imdbId, season, episode }` to D and expects `{ url, title }` back.

Episode titles come from filenames on D's side. A currently extracts the title itself from the URL filename — this logic moves to D, and A simply uses the `title` field in D's response for the Stremio stream payload.

Failure logs (quarantine events) currently accumulate in Redis on A. At night (during the shutdown window), A should ship these to D for centralized storage. D's nightly collection replaces A's local-only rollup for failure data.

## Constraints

- **Tech Stack**: Node.js, CommonJS, Vercel serverless — no new frameworks
- **D not live yet**: D client must stub gracefully; A must degrade safely if D is unreachable
- **Existing policy gates untouched**: Time window, session gate, operator auth — no changes
- **Stremio protocol compliance**: Stream payload format must remain valid for Stremio clients

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| A routes through D, not B directly | D owns all data/cache/enrichment; A stays thin | — Pending |
| D client stubbed until D is live | D not built yet; need A ready independently | — Pending |
| Local analytics stay in A for now | Not in scope for this milestone | — Pending |
| Episode title comes from D | D reads filename → A stops parsing URLs for titles | — Pending |

---
*Last updated: 2026-02-28 after initialization*
