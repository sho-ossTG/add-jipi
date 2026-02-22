# Phase 3: Stream Reliability Controls - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Make stream resolution deterministic and protocol-safe under concurrency pressure and dependency degradation. This phase defines how reliability behavior appears to clients for stream requests, without expanding into new product capabilities.

</domain>

<decisions>
## Implementation Decisions

### Concurrency outcomes under load
- Use fair rotation when capacity is reached: oldest idle session can be replaced by a new contender.
- When blocked by capacity/policy, return empty `streams` with a clear busy reason (not non-stream hard error).
- Keep a short reconnect grace window so brief disconnects can retain session continuity.
- Coalesce burst requests from the same client as one active intent.

### Dependency wait behavior
- Use a moderate wait budget for dependency calls.
- Timeout messaging should be actionable (clear retry guidance), without deep technical internals.
- Allow one quick retry for transient failures before final outcome.
- If dependency latency crosses threshold, return early deterministic degraded response.

### Degraded-mode response style
- Use hybrid degraded behavior: empty streams for capacity/policy causes, fallback playable stream for dependency-failure causes.
- Keep response shape consistent, with cause-specific message text.
- Provide mid-level actionable transparency (busy/timeout/retry-soon style).
- Same cause must map to the same degraded output pattern (deterministic mapping).

### Retry and duplicate request behavior
- Join identical in-flight requests (same client + same episode) and share one result.
- For rapid episode switching by the same client, latest request wins.
- Retry timing uses short jittered backoff to reduce synchronized spikes.
- Client responses should prioritize deterministic final outcomes without exposing internal retry/merge step states.

### Claude's Discretion
- Exact wording of actionable degraded messages.
- Specific grace-window and jitter ranges, as long as behavior remains aligned with locked decisions.
- Precise mapping table format from cause categories to response messages.

</decisions>

<specifics>
## Specific Ideas

- "Fair rotation" under load instead of strict first-come lockout.
- "Hybrid degraded style": empty streams for capacity/policy, fallback stream for dependency failures.
- Deterministic client-facing behavior is preferred over adaptive/noisy signaling.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

*Phase: 03-stream-reliability-controls*
*Context gathered: 2026-02-22*
