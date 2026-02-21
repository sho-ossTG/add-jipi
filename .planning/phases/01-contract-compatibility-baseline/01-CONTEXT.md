# Phase 1: Contract Compatibility Baseline - Context

**Gathered:** 2026-02-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver protocol-valid `manifest`, `catalog`, and `stream` responses for supported episodes so users can install and use the addon reliably in client flow. This phase is about compatibility baseline and behavior clarity, not adding new capabilities.

</domain>

<decisions>
## Implementation Decisions

### Baseline compatibility guardrail
- `serverless.js` is source of truth for current Phase 1 behavior decisions where code already defines policy.
- Keep baseline-compatible behavior in this phase; improvements beyond baseline are deferred unless strictly non-breaking and within phase boundary.

### Reliability behavior (locked from current implementation)
- Reliability policy follows current hybrid behavior: stream routes prefer protocol-safe stream responses; non-stream paths return JSON errors/statuses.
- Fallback eligibility follows current stream handling: fallback stream is used for control blocks, broker/resolve failures, HTTPS-invalid resolved URLs, and top-level stream errors.
- Retry behavior remains current: no explicit retry loop before responding.
- User preference captured for direction: correctness over continuity (prefer clear failure over uncertain/stale fallback), but baseline behavior remains fixed in this phase.

### Client-visible performance preferences
- Prefer predictable response bands over fastest-but-spiky behavior.
- Use moderate dependency wait budget (balanced success chance vs client wait time).
- Prioritize manifest/catalog responsiveness.
- Client-facing performance failures should be actionable (not only generic unavailable text).

### Caching behavior preferences
- Prefer fresh resolution over aggressive cache reuse.
- Cache reuse should stay constrained to exact episode and same client identity context.
- Do not serve uncertain stale data; fail clearly instead.
- Provide light client-facing indication when degraded/cached behavior is in effect.

### Error and observability contract preferences
- Keep current mixed error shape in Phase 1 for compatibility.
- Favor dual-format signaling where possible: stable machine-meaning + short human-readable message.
- Do not expose correlation IDs publicly in this phase.
- Client-visible error granularity should be mid-level (e.g., timeout/upstream/capacity/policy categories), not over-technical internals.

### Claude's Discretion
- Exact wording style for actionable error messages.
- Which non-breaking compatibility checks are best validated first in planning order.
- How to represent light degraded/cached hints without changing protocol compatibility.

</decisions>

<specifics>
## Specific Ideas

- "I want improvement ideas, not just baseline compliance."
- "Treat `serverless.js` as source of truth and extract decisions from it."
- "Focus on reliability, performance, caching, error handling, and observability from a user/client perspective."

</specifics>

<deferred>
## Deferred Ideas

- Shift stream behavior from continuity-biased fallback toward correctness-biased failure semantics where uncertainty exists.
- Introduce explicit retry/timeout policy tuning beyond current baseline behavior.
- Add standardized client-facing error contract (single normalized shape) once compatibility impact is assessed.
- Add explicit safe observability hints (including optional request tracing metadata) for support workflows.
- Expand caching strategy controls beyond baseline exact-match reuse rules.

</deferred>

---

*Phase: 01-contract-compatibility-baseline*
*Context gathered: 2026-02-21*
