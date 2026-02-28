# Architecture Research — Server A → D Integration

**Domain:** Serverless Stremio addon with external resolution middleware
**Researched:** 2026-02-28
**Based on:** Direct codebase analysis of all relevant source files

---

## Integration Points

D client plugs into the existing integration layer at a single, well-defined seam. Two files currently own the broker dependency; both must be updated.

### `modules/integrations/d-client.js` (NEW)

Primary new file. Replaces `broker-client.js` as the resolution transport. Must expose a factory `createDClient(options)` returning:

- `resolveEpisode(episodeId)` — replaces `brokerClient.resolveEpisode`; same calling contract used by `stream-route.js`
- `forwardUserAgent(userAgent, episodeId)` — fire-and-forget UA shipping
- `shipFailureLogs(events)` — fire-and-forget nightly log shipping

Factory accepts: `options.baseUrl`, `options.fetchImpl`, `options.executeBoundedDependency`, `options.env` — identical pattern to `broker-client.js` lines 133–140.

When `D_BASE_URL` is unset, `resolveEpisode` throws immediately (same guard as `broker-client.js` line 147–149). `forwardUserAgent` and `shipFailureLogs` silently no-op when `D_BASE_URL` is unset — they are side channels, never blockers.

### `modules/routing/stream-route.js` (MODIFIED)

Lines 105–120 define `resolveEpisodeResolver(injected)`. Currently falls through to `createBrokerClient`. Must be updated to fall through to `createDClient`. The internal calling contract — `injected.resolveEpisode(episodeId)` returning `{ url, title }` — does not change.

`title` currently comes from `cleanTitle(resolvedFilename)` inside `broker-client.js`. After migration, `title` comes directly from D's response. `cleanTitle` and `resolveBrokerFilename` become dead code.

UA forwarding called here after successful resolution, fire-and-forget (same pattern as `writeSessionView` best-effort paths, lines 130–146). Not awaited in critical path.

### `addon.js` (MODIFIED)

- Line 2: `require("./modules/integrations/broker-client")` → `require("./modules/integrations/d-client")`
- Line 18: `createBrokerClient()` → `createDClient()`
- Line 38: `brokerClient.resolveEpisode(episodeId)` → `dClient.resolveEpisode(episodeId)`

Second consumer of broker client. Uses only `resolveEpisode`. Stremio SDK stream handler in `addon.js` lines 41–67 uses the resolved `title` directly (line 57) — continues to work unchanged because D returns `title` natively.

### `modules/routing/operator-routes.js` (MODIFIED — nightly log shipping)

Log shipping triggers during the nightly window alongside the existing rollup. `handleOperatorRoute` handles `/operator/rollup/nightly` at lines 192–211. A new path `/operator/ship/logs` (or a flag on the existing nightly trigger) calls `dClient.shipFailureLogs(events)` by reading `quarantine:events` from Redis and POSTing to D's log collection endpoint. Fire-and-forget: failure swallowed and logged, never surfaced to operator response.

### `modules/integrations/broker-client.js` (DEPRECATED, not deleted yet)

Kept until D client is validated in production. Referenced in two places: `addon.js` line 2 and `stream-route.js` line 1. After D client is wired in, both references are removed. File remains as reference implementation until milestone closes.

---

## Component Boundaries

### What A owns and keeps doing

- Time window policy evaluation (`modules/policy/time-window.js`)
- Session capacity gate (`modules/policy/session-gate.js`)
- Per-episode Redis share key management (`episode:share:*` in `stream-route.js`)
- Hourly analytics tracking (`modules/analytics/hourly-tracker.js`)
- Session view snapshots (`modules/analytics/session-view.js`)
- Nightly rollup of hourly buckets into daily summaries (`modules/analytics/nightly-rollup.js`)
- Stremio protocol compliance (manifest, catalog, stream payload format)
- CORS, correlation IDs, operator authentication
- Reliability counters and degraded stream policy

### What A delegates to D

- Episode resolution: A sends episodeId → D returns `{ url, title }`
- All DB writes, cache population, B/C orchestration — fully opaque to A
- Episode title extraction from filename — D reads the filename, returns clean `title`; A stops parsing filenames
- User-Agent storage — A forwards raw UA header as side-channel POST
- Centralized failure log collection — A ships `quarantine:events` to D during nightly window

### The boundary rule

A must never call Server B or C directly. All resolution goes through D's single `/resolve` endpoint. A must not know about B's or C's existence. Any logic that inspects broker URLs, parses filenames, or applies B-specific URL patterns must be removed from A.

---

## Data Flow

### Primary path: stream resolution

```
Stremio client
  → GET /stream/series/{episodeId}.json
  → createHttpHandler (modules/routing/http-handler.js)
    → applyRequestControls: time-window + session gate
    → handleStreamRequest (modules/routing/stream-route.js)
      → check Redis episode:share:{episodeId} (cache hit path)
      → cache miss: resolveEpisodeResolver(injected) → dClient.resolveEpisode(episodeId)
        → POST /api/resolve to D_BASE_URL
        → D returns { url, title }
      → validate url starts with https://
      → write episode:share key to Redis
      → upsertSessionView (best-effort)
      → trackHourlyEvent (best-effort)
      → sendJson: { streams: [formatStream(title, url)] }
  ← 200 JSON to Stremio client
```

### UA forwarding path (fire-and-forget side channel)

```
handleStreamRequest (after resolveEpisode succeeds, before sendJson)
  → dClient.forwardUserAgent(userAgent, episodeId)   [not awaited]
    → POST /api/ua to D_BASE_URL
    → body: { userAgent, episodeId, timestamp }
    → on any error: swallow silently, no retry
    → D_BASE_URL unset: no-op immediately
```

### Log shipping path (nightly side channel)

```
Nightly window trigger (/operator/ship/logs or /operator/rollup/nightly)
  → read quarantine:events from Redis (LRANGE quarantine:events 0 -1)
  → dClient.shipFailureLogs(events)   [awaited but errors swallowed]
    → POST /api/logs to D_BASE_URL
    → body: { events: [...], shippedAt, source: "server-a" }
    → on error: log at WARN, do not throw, do not block rollup
    → D_BASE_URL unset: no-op, return immediately
```

---

## Suggested Build Order

**Phase 1: Define D client module (stub-first)**
Build `modules/integrations/d-client.js`. All three functions stub gracefully when `D_BASE_URL` is unset. Write contract tests for stub behavior. Nothing in request path changes yet.

**Phase 2: Wire resolveEpisode into the resolution path**
Update `resolveEpisodeResolver` in `stream-route.js` to fall through to `createDClient`. Update `addon.js`. Remove title extraction from broker-specific helpers. Update existing stream contract tests to inject mock D client.

**Phase 3: Add UA forwarding**
Add fire-and-forget `forwardUserAgent` call in `stream-route.js` success branch. Confirm it never propagates errors.

**Phase 4: Add nightly log shipping**
Add `shipFailureLogs` trigger in `operator-routes.js`. Test that shipping failure does not block rollup.

**Phase 5: Deprecate broker-client.js**
After D is live and stable in production, remove all `broker-client.js` references and delete the file.

---

## Module Structure Changes

### New files

| File | Purpose |
|------|---------|
| `modules/integrations/d-client.js` | D service client: resolveEpisode, forwardUserAgent, shipFailureLogs |
| `tests/contract-d-client.test.js` | Contract tests: stub behavior, error handling, fire-and-forget isolation |

### Modified files

| File | Change |
|------|--------|
| `addon.js` | Replace `createBrokerClient` import/instantiation with `createDClient` |
| `modules/routing/stream-route.js` | `resolveEpisodeResolver` → `createDClient`; add UA forwarding call; remove title extraction |
| `modules/routing/operator-routes.js` | Add log shipping trigger; call `dClient.shipFailureLogs` |
| `modules/routing/http-handler.js` | Pass `D_BASE_URL` into dependency builder; add env var parsing |

### Deprecated (not deleted this milestone)

| File | Status |
|------|--------|
| `modules/integrations/broker-client.js` | Call sites removed in Phase 2; file deleted in Phase 5 |

---

## Contract Definition

### POST /api/resolve

```
Request:  { "episodeId": "tt0388629:1:1" }

Success 200:
  { "url": "https://...", "title": "Romance Dawn" }

Errors:
  404 → degraded stream (empty)
  503 → degraded stream (fallback video)
  408 / 429 / 5xx → transient; retry once with jitter

Timeout: 60s total, 60s per attempt
```

`url` must be HTTPS. `title` used verbatim in `formatStream(title, url)` — no local transformation. A validates `url.startsWith("https://")` and emits `validation_invalid_stream_url` on failure.

### POST /api/ua

```
Request:  { "userAgent": "...", "episodeId": "tt0388629:1:1", "timestamp": "ISO8601" }
Response: any 2xx
Errors:   silently swallowed, no retry, no effect on stream response
Unset D_BASE_URL: call never made
```

### POST /api/logs

```
Request:
  {
    "source": "server-a",
    "shippedAt": "ISO8601",
    "events": [
      { "ip": "1.2.3.4", "error": "...", "episodeId": "...", "time": "ISO8601" }
    ]
  }

Response: any 2xx
Errors:   logged at WARN, swallowed, nightly rollup continues
Unset D_BASE_URL: call never made
```

### Failure classification

D errors use `source: "broker"` for backwards compatibility with existing `DEGRADED_STREAM_POLICY` and reliability counter labels. A new `SOURCES.D = "d"` entry in `observability/events.js` is deferred to a future milestone after D is live.

---

*Analysis based on direct codebase reading: 2026-02-28*
