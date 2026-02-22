# Phase 3: Stream Reliability Controls - Research

**Researched:** 2026-02-22
**Domain:** Deterministic stream reliability controls for Redis-gated concurrency, bounded dependency calls, and protocol-safe degraded responses
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
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

### Deferred Ideas (OUT OF SCOPE)
None - discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RELY-01 | User stream requests enforce capacity/session policy with atomic Redis-backed gating under concurrency. | Use Upstash `/multi-exec` (atomic) or Redis `EVAL` script for admit/rotate/heartbeat in one operation; avoid `/pipeline` for gate decisions because it is explicitly non-atomic. |
| RELY-02 | User stream resolution uses bounded dependency calls (timeouts and retry limits) to avoid hung requests. | Use `AbortSignal.timeout(...)` for hard request deadlines and one jittered retry only on transient classes (`408/429/5xx`, reset/timeout). Keep bounded total budget. |
| RELY-03 | User receives deterministic fallback behavior when broker or Redis dependencies fail. | Keep stream response contract (`{ streams: [...] }` or `{ streams: [] }`) with fixed cause-to-output mapping: capacity/policy => empty streams; dependency failures => fallback playable stream with actionable message. |
</phase_requirements>

## Summary

Phase 3 planning should treat reliability as a deterministic state machine at the stream boundary, not as scattered best-effort checks. The current `serverless.js` flow performs slot checks over multiple independent Redis calls via `/pipeline`; Upstash documents that pipeline execution is not atomic, so concurrent clients can interleave and produce inconsistent admission outcomes. This is the key technical risk for `RELY-01` and should be solved first.

The dependency path is also currently unbounded in places: broker/Redis fetches can hang without strict per-call timeout budgeting. Node provides stable `fetch` plus `AbortSignal.timeout(...)`, which enables a strict deadline and a single bounded retry. That satisfies `RELY-02` while keeping latency predictable and avoiding retry storms.

Protocol behavior should remain Stremio-safe and deterministic. The Stremio SDK contract allows returning `{ streams: [] }` and stream arrays. Plan a fixed cause map so the same cause always produces the same response pattern. This directly supports `RELY-03` and aligns with locked context decisions.

**Primary recommendation:** Implement one atomic Redis gate primitive (transaction or Lua) plus a bounded dependency executor (timeout + single jittered retry), then enforce a strict cause-to-response mapping table for all stream outcomes.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `stremio-addon-sdk` | `1.6.10` | Stream contract and route handling (`defineStreamHandler`, stream response shape) | Existing project standard; official protocol alignment without hand-rolled transport parsing. |
| Upstash Redis REST (`/multi-exec`) | current REST API | Atomic multi-command gate decisions over HTTP | Official Upstash transaction endpoint for atomicity; required to meet `RELY-01`. |
| Node.js global `fetch` + `AbortSignal.timeout` | Node runtime built-in | Bounded dependency call deadlines | Native implementation, no extra dependency, direct timeout semantics. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Redis Lua `EVAL` | Redis OSS `>=2.6.0` | Single-operation atomic gate logic with branching | Use when gate logic becomes too complex for plain transaction sequencing. |
| `node:test` | built-in | Deterministic reliability regression tests | Use for concurrency admission, retry bounds, degraded mapping determinism. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Upstash `/multi-exec` transaction | Upstash `/pipeline` | `/pipeline` is simpler but explicitly non-atomic; unsafe for gate correctness under concurrency. |
| Redis transaction | Redis Lua script (`EVAL`) | Lua is more expressive and often simpler for complex branch logic; adds script-management complexity. |
| Immediate hard failure on first dependency error | Single bounded retry with jitter | Retry improves transient success rate, but must stay bounded to protect latency and determinism. |

**Installation:**
```bash
npm install stremio-addon-sdk@1.6.10 proxy-addr@2.0.7
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── reliability/
│   ├── gate.js            # atomic Redis gate, rotation, grace, heartbeat
│   ├── inFlight.js        # dedupe/join logic per (client, episode)
│   ├── dependency.js      # timeout + bounded retry executor
│   └── degradedMap.js     # deterministic cause -> protocol-safe response map
├── handlers/
│   └── stream.js          # stream route orchestration using reliability primitives
└── server.js              # route boundary, auth/cors/public shaping
```

### Pattern 1: Atomic gate-and-heartbeat command
**What:** Perform session cleanup, capacity check, fair rotation decision, and heartbeat write as one atomic Redis operation.
**When to use:** Every stream admission decision (`RELY-01`).
**Example:**
```javascript
// Source: https://upstash.com/docs/redis/features/restapi
// Use /multi-exec (transaction) for atomic command group.
await fetch(`${redisUrl}/multi-exec`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify([
    ["ZREMRANGEBYSCORE", sessionsKey, "-inf", String(cutoff)],
    ["ZCARD", sessionsKey],
    ["ZSCORE", sessionsKey, clientIp],
    ["ZADD", sessionsKey, String(now), clientIp],
    ["EXPIRE", sessionsKey, String(slotTtlSec)]
  ])
});
```

### Pattern 2: Bounded dependency executor
**What:** Wrap outbound broker/Redis HTTP calls with strict timeout and one bounded retry.
**When to use:** Any external dependency call in stream path (`RELY-02`).
**Example:**
```javascript
// Source: https://nodejs.org/api/globals.html#fetch
async function callWithBudget(url, opts, timeoutMs) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
}
```

### Pattern 3: Deterministic degraded mapping
**What:** Central table maps cause category to one stable response pattern.
**When to use:** All blocked/degraded/error stream exits (`RELY-03`).
**Example:**
```javascript
// Source: Stremio stream handler contract
// https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/api/requests/defineStreamHandler.md
const degradedByCause = {
  capacity_busy: () => ({ streams: [] }),
  policy_blocked: () => ({ streams: [] }),
  dependency_timeout: () => ({ streams: [fallbackStream("Temporary timeout. Retry shortly.")] }),
  redis_unavailable: () => ({ streams: [fallbackStream("System busy. Retry shortly.")] })
};
```

### Anti-Patterns to Avoid
- **Non-atomic gating via `/pipeline`:** interleaving creates inconsistent admissions under concurrency.
- **Unbounded retries or no timeout:** causes hung requests and unpredictable tail latency.
- **Cause-specific behavior spread across handlers:** breaks determinism and makes regressions likely.
- **Exposing internal retry/merge states to clients:** violates locked decision for deterministic final outcomes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic admission under concurrency | Multi-step local JS decision over several Redis calls | Upstash `/multi-exec` or Redis `EVAL` | Atomic server-side execution prevents race-driven inconsistent outcomes. |
| Deadline enforcement | `Promise.race` timeout wrappers everywhere | `AbortSignal.timeout(...)` with `fetch` | Native cancellation path, simpler error handling, fewer leaks. |
| Retry policy design from scratch | Ad-hoc loops without transient classification | Bounded retry policy (transient-only, 1 retry, jitter) | Prevents retry storms and keeps latency within budget. |
| Protocol fallback shaping per call site | Scattered if/else response objects | Centralized cause-to-response mapping table | Guarantees deterministic client-visible behavior. |

**Key insight:** Reliability bugs in this phase come from race windows and policy drift; centralized primitives (atomic gate, bounded executor, deterministic mapper) are safer than distributed custom logic.

## Common Pitfalls

### Pitfall 1: Assuming Upstash pipeline is atomic
**What goes wrong:** concurrent requests see stale counts and both admit or both reject incorrectly.
**Why it happens:** `/pipeline` preserves order but allows interleaving from other clients.
**How to avoid:** use `/multi-exec` or `EVAL` for all gate decisions.
**Warning signs:** flaky concurrency tests, intermittent over-capacity sessions.

### Pitfall 2: Retrying non-idempotent operations blindly
**What goes wrong:** duplicate side effects or duplicated queued work.
**Why it happens:** no idempotency guard around retryable operations.
**How to avoid:** retry only transient failures and only on idempotent or deduped operations.
**Warning signs:** duplicate quarantine events, duplicate per-request artifacts.

### Pitfall 3: Timeout budget ignored by retry
**What goes wrong:** one retry makes total latency exceed acceptable stream response time.
**Why it happens:** per-attempt timeout configured, total operation budget not enforced.
**How to avoid:** set per-attempt deadline plus total budget ceiling.
**Warning signs:** long-tail latency spikes after dependency degradation.

### Pitfall 4: Non-deterministic degraded responses
**What goes wrong:** same failure cause sometimes returns empty streams and sometimes fallback stream.
**Why it happens:** multiple catch blocks with local branching.
**How to avoid:** enforce a single cause classification + mapping table.
**Warning signs:** tests intermittently failing on expected response shape.

### Pitfall 5: In-flight dedupe leaking memory
**What goes wrong:** promise map grows when entries are not cleared on all completion paths.
**Why it happens:** missing `finally` cleanup.
**How to avoid:** always delete dedupe key in `finally`; include timeout/abort path.
**Warning signs:** process memory increases with repeated same-key requests.

## Code Examples

Verified patterns from official sources:

### Atomic Upstash transaction endpoint
```bash
# Source: https://upstash.com/docs/redis/features/restapi
curl -X POST https://<db>.upstash.io/multi-exec \
  -H "Authorization: Bearer $TOKEN" \
  -d '[ ["ZCARD", "system:active_sessions"], ["ZADD", "system:active_sessions", 1700000000000, "203.0.113.1"] ]'
```

### Stream handler may return empty streams
```javascript
// Source: https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/api/requests/defineStreamHandler.md
builder.defineStreamHandler(async () => ({ streams: [] }));
```

### AbortSignal timeout for bounded fetch
```javascript
// Source: https://nodejs.org/api/globals.html#fetch
const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Multi-command gate logic over non-atomic pipelines | Atomic transaction/script for concurrency gates | Upstash REST docs (current) explicitly distinguish non-atomic pipeline vs atomic transaction | Prevents race-condition admission drift under load. |
| Best-effort dependency calls without strict deadline | Hard bounded calls with abortable timeout and bounded retry | Modern Node global `fetch`/Abort APIs stabilized | Keeps requests from hanging and bounds tail latency. |
| Ad-hoc fallback decisions in catch blocks | Central deterministic cause map | Reliability hardening practice in mature service design | Stable client behavior, easier testability and auditing. |

**Deprecated/outdated:**
- Using Upstash `/pipeline` for any decision that requires atomic read-modify-write correctness.
- Unlimited or high-count retries on stream-path dependencies.

## Open Questions

1. **Exact timeout and jitter values within the locked “moderate/short” bounds**
   - What we know: must be moderate wait budget, one quick retry, short jitter.
   - What's unclear: concrete defaults that best fit current production latency profile.
   - Recommendation: plan with configurable defaults (`timeoutMs`, `retryJitterMs`) and set initial values conservatively; tune with phase verification metrics.

2. **Fair rotation algorithm detail for “oldest idle session can be replaced”**
   - What we know: replacement rule is locked.
   - What's unclear: exact idle definition and tie-break ordering.
   - Recommendation: define idle by `last_seen <= now - inactivityLimit`; tie-break lexicographically by member for deterministic behavior.

## Sources

### Primary (HIGH confidence)
- `https://upstash.com/docs/redis/features/restapi` - pipeline non-atomic note, `/multi-exec` transaction behavior and request format.
- `https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/protocol.md` - addon route protocol and stream endpoint contract context.
- `https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/api/requests/defineStreamHandler.md` - stream handler return contract (`{ streams: [] }` valid).
- `https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/api/responses/stream.md` - stream object fields and behavior hints.
- `https://nodejs.org/api/globals.html#fetch` - Node global fetch + AbortSignal API stability.
- `https://redis.io/docs/latest/develop/using-commands/transactions/` - Redis transaction atomicity and behavior.
- `https://redis.io/docs/latest/commands/eval/` - Lua scripting command for atomic server-side logic.

### Secondary (MEDIUM confidence)
- `https://cloud.google.com/storage/docs/retry-strategy` - transient error classes, bounded retries, idempotency guidance, exponential backoff defaults.
- `https://learn.microsoft.com/en-us/azure/well-architected/design-guides/handle-transient-faults` - retry/jitter anti-patterns and operational guidance.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - grounded in current project dependencies plus official Upstash/Stremio/Node docs.
- Architecture: HIGH - atomicity and timeout patterns directly supported by primary docs.
- Pitfalls: MEDIUM - strongly evidenced, but exact threshold tuning depends on runtime characteristics not measured in this research step.

**Research date:** 2026-02-22
**Valid until:** 2026-03-24
