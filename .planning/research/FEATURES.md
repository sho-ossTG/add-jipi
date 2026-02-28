# Features Research — Server A → D Integration

**Date:** 2026-02-28

---

## Table Stakes (must have or integration breaks)

### 1. D Client Module
Replace `modules/integrations/broker-client.js` as the stream resolution caller. A sends `{ imdbId, season, episode }` to D and receives `{ url, title }` back. This is the load-bearing change everything else depends on.
- **Complexity:** Medium
- **Why required:** Without this, A still calls B directly — the architecture isn't changed at all.

### 2. Remove Local Title Extraction
Delete `cleanTitle` / `resolveBrokerFilename` logic in the stream handler. Use `d.title` verbatim from D's response instead of parsing it from the URL filename.
- **Complexity:** Low
- **Why required:** If A still extracts its own title, D's episode title enrichment is bypassed and results are inconsistent.

### 3. D Client Interface Contract
Define and pin the HTTP contract before D is built: `POST /resolve` with body `{ imdbId, season, episode }` → response `{ url, title }`. Document error response shapes. This contract is the source of truth for both A and D development.
- **Complexity:** Low
- **Why required:** Without a pinned contract, A and D will drift and integration will break on first contact.

### 4. Stubbed D Client for Pre-Live
When `D_BASE_URL` is unset, the D client throws `{ code: 'dependency_unavailable', source: 'd' }`. The existing degradation path in `stream-route.js` catches this and returns a degraded stream — no new error handling needed.
- **Complexity:** Low
- **Why required:** D doesn't exist yet. A must not break when D is unreachable.

### 5. Forward User-Agent to D (fire-and-forget)
`requestUserAgent` is already extracted in `stream-route.js`. Send it to D as a non-blocking background POST. No `await`, no error propagation. If D is down, UA is simply not forwarded — acceptable loss.
- **Complexity:** Low
- **Why required:** Per spec, A must send UA to D for centralized storage. A must not store it locally.

### 6. Ship Failure Logs to D at Nightly Shutdown
During the shutdown window trigger (`/operator/rollup/nightly`): drain the `quarantine:events` Redis list, POST all events to D's log collection endpoint, clear the local list on success. Integrate into the existing nightly rollup flow.
- **Complexity:** Medium
- **Why required:** Per spec, D collects failure logs from all servers at night. A must send, not just accumulate locally.

---

## Differentiators (quality improvements, not blockers)

### D Client Timeout Parity
Reuse `executeBoundedDependency` with tighter timeouts than the broker (10s attempt / 15s total vs broker's 60s). D is local infrastructure, not an external service.
- **Complexity:** Low

### Correlation ID in UA Forward Payload
Include `x-correlation-id` in the UA forward body so D can trace requests end-to-end.
- **Complexity:** Low

### Report `failuresShipped` in Nightly Rollup Response
Add count of events shipped to D in the nightly rollup JSON response body. Useful for operator visibility.
- **Complexity:** Low

### Rename Telemetry Source
Update failure classification source from `"broker"` to `"d"` in `observability/events.js` so metrics correctly attribute D failures.
- **Complexity:** Low

---

## Anti-features (deliberately NOT building)

| Thing | Why Not |
|-------|---------|
| D response cache in A | A's existing Redis episode share layer is sufficient; double-caching adds complexity |
| Move hourly analytics to D | Out of scope per PROJECT.md — stays in A's Redis layer |
| Move session tracking to D | Same — not in this milestone |
| Title normalization on D output | Use D's title verbatim; normalization is D's responsibility |
| Changes to policy gates / session management / operator routes | Not in scope — existing behavior untouched |
| Retry on UA forward | Fire-and-forget — UA is low-value, retrying adds complexity for no meaningful gain |
| A-side log collection endpoint | A ships logs outbound to D; A doesn't receive logs from others |

---

## Feature Dependencies

```
D Client Contract (3)
    └── D Client Module (1)
            ├── Remove Title Extraction (2)
            ├── Stub Mode (4)
            ├── UA Forwarding (5)
            └── Log Shipping (6)
```

Contract must be defined first. All other features depend on the D client module existing.

---

## Complexity Summary

| Feature | Complexity | Notes |
|---------|------------|-------|
| D Client Module | Medium | Clone broker-client.js pattern; bounded dependency |
| Remove Title Extraction | Low | Delete code, use d.title |
| D Client Contract | Low | Document only — no code |
| Stub Mode | Low | Env var check, structured error return |
| UA Forwarding | Low | Fire-and-forget POST |
| Log Shipping | Medium | Redis drain + POST + clear; timing with shutdown window |
