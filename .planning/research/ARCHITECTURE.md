# Architecture Research

**Domain:** Stremio addon backend service (serverless stream resolver)
**Researched:** 2026-02-21
**Confidence:** HIGH

## Standard Architecture

### System Overview

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         HTTP Transport (Serverless)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌────────────────┐  ┌─────────────────────────────┐  │
│  │ Request Router  │  │ Route Guards   │  │ Stremio Protocol Adapter    │  │
│  │ (path dispatch) │  │ (auth + CORS)  │  │ (manifest/catalog fallback) │  │
│  └────────┬────────┘  └───────┬────────┘  └──────────────┬──────────────┘  │
├───────────┴────────────────────┴──────────────────────────┴─────────────────┤
│                    Stream Application Layer                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │ Policy Engine  │  │ Stream Service  │  │ Admin/Health Service        │  │
│  │ (admission)    │  │ (resolve+format)│  │ (diagnostics summaries)     │  │
│  └────────┬───────┘  └────────┬────────┘  └──────────────┬──────────────┘  │
├───────────┴────────────────────┴──────────────────────────┴─────────────────┤
│                     Integration + Telemetry Layer                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────────────────┐ │
│  │ Redis Gateway  │  │ Broker Client  │  │ Observability Sink            │ │
│  │ (state/cache)  │  │ (episode->URL) │  │ (structured events+metrics)   │ │
│  └────────────────┘  └────────────────┘  └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `transport/router` | Parse request, route by path, map errors to protocol-safe responses | Thin module used by `serverless.js` entrypoint |
| `transport/guards` | Enforce admin auth, route-specific CORS, trusted client IP extraction | Middleware-style pure functions |
| `application/policy-engine` | Slot/session checks, time-window policy, rejection reasons | Policy service returning typed allow/deny decision |
| `application/stream-service` | Stream request orchestration, cache lookup, broker resolve, stream payload formatting | Stateless service composed from policy + integrations |
| `application/admin-service` | Health/quarantine data aggregation with redaction | JSON-first handlers (HTML optional and escaped) |
| `integrations/redis-gateway` | Command batching, key naming, TTL behavior, retries/timeouts | Single module owning Redis REST semantics |
| `integrations/broker-client` | Resolve episode to HTTPS URL with timeout, validation, error mapping | Fetch wrapper with abort + typed failures |
| `observability/telemetry` | Emit structured logs, counters, latency, correlation IDs | Event writer to Redis and stdout JSON fallback |

## Recommended Project Structure

```text
src/
├── entry/
│   └── serverless.js            # Runtime adapter; compose router/services only
├── transport/
│   ├── router.js                # Route table + handler dispatch
│   ├── guards.js                # Admin auth, CORS, IP trust policy
│   └── response.js              # JSON + Stremio-safe response helpers
├── application/
│   ├── stream-service.js        # Main stream flow orchestration
│   ├── policy-engine.js         # Admission policy decisions
│   └── admin-service.js         # Health/quarantine summary endpoints
├── domain/
│   ├── stremio-addon.js         # Manifest/catalog/stream contract wrappers
│   └── stream-model.js          # Stream DTO validation/normalization
├── integrations/
│   ├── redis-gateway.js         # Redis REST client + key operations
│   └── broker-client.js         # Broker resolve API client
├── observability/
│   ├── telemetry.js             # Structured event emitters
│   └── metrics.js               # Counters/latency utilities
└── config/
    └── env.js                   # Centralized env parsing and defaults
```

### Structure Rationale

- **`entry/` and `transport/`:** Keeps serverless runtime specifics isolated so addon contract remains stable while internals evolve.
- **`application/`:** Encapsulates use-case orchestration (stream route, policy, admin) without Redis/fetch details.
- **`domain/`:** Preserves Stremio compatibility as a stable boundary and limits protocol changes to one area.
- **`integrations/`:** Centralizes failure-prone external calls (Redis and broker) for timeout/retry/security hardening.
- **`observability/`:** Makes telemetry a first-class dependency instead of ad-hoc `catch` behavior.

## Architectural Patterns

### Pattern 1: Intercept-and-Delegate Routing

**What:** Intercept only custom high-risk routes (`/stream/*`, `/health`, `/quarantine`), delegate other Stremio routes to SDK router.
**When to use:** Maintaining strict addon compatibility while adding custom policy/security behavior.
**Trade-offs:** Preserves compatibility and reduces regression risk, but requires clear route ownership to avoid double handling.

**Example:**
```javascript
async function handle(req, res) {
  const route = matchRoute(req.url)
  if (route.type === "stream") return streamHandler(req, res)
  if (route.type === "admin") return adminHandler(req, res)
  return stremioRouter(req, res)
}
```

### Pattern 2: Policy Decision Object

**What:** Policy layer returns typed decisions (`ALLOW`, `DENY_SLOT`, `DENY_WINDOW`, `DEGRADED_ALLOW`) plus metadata.
**When to use:** Security and admission policies must be auditable and observable.
**Trade-offs:** More explicit behavior and logs, but small upfront refactor from inline conditionals.

**Example:**
```javascript
const decision = await policyEngine.evaluate({ ip, path, now })
if (!decision.allow) return sendBlockedStream(res, decision.reason)
```

### Pattern 3: Integration Adapters with Bounded Calls

**What:** All network calls use adapters with timeout, validation, and normalized error codes.
**When to use:** Serverless systems with external dependencies and strict latency budgets.
**Trade-offs:** Slightly more boilerplate, but significantly simpler incident triage and fallback control.

## Data Flow

### Request Flow

```text
Stremio client request
    ↓
transport/router -> transport/guards
    ↓
application/stream-service
    ↓
application/policy-engine -> integrations/redis-gateway
    ↓ allow
integrations/redis-gateway (cache lookup)
    ↓ miss
integrations/broker-client (resolve)
    ↓
domain/stream-model normalize + validate
    ↓
transport/response (Stremio stream JSON)
    ↓
observability/telemetry emits outcome + latency + reason codes
```

### State Management

```text
Redis as single shared state:
- admission/session keys (policy)
- short-lived stream URL cache
- telemetry counters/event ring

No in-memory required state in runtime process.
```

### Key Data Flows

1. **Secure stream routing flow:** Guard trusted IP and route policy before broker calls; never resolve stream for denied requests.
2. **Policy enforcement flow:** Policy engine reads/writes session windows atomically (or batched) and returns machine-readable denial reason.
3. **Observability flow:** Every stream decision emits structured event (`request_id`, `episode_id`, `policy_result`, `dependency_status`, `latency_ms`).
4. **Admin diagnostics flow:** Protected endpoint reads redacted telemetry aggregates, not raw unescaped event payloads.

## Incremental Build Order

1. **Stabilize boundaries without behavior change**
   - Extract `redis-gateway`, `broker-client`, and response helpers from monolith.
   - Keep `serverless.js` route behavior and payloads identical.
   - Success criteria: zero contract change for manifest/catalog/stream responses.

2. **Isolate policy engine and decision codes**
   - Move slot/window/IP logic into `policy-engine` with typed decisions.
   - Add trusted-forwarded-header rules and explicit deny reasons.
   - Success criteria: same allow/deny outcomes plus reliable attribution and logs.

3. **Split stream and admin application services**
   - Create `stream-service` and `admin-service`; reduce entrypoint to composition.
   - Convert quarantine/health internals to JSON-first service outputs.
   - Success criteria: simpler route ownership and reduced blast radius.

4. **Add secure admin access and output hardening**
   - Require auth on admin routes, escape/sanitize rendered fields, tighten CORS per route.
   - Success criteria: operational data no longer public; injection vector closed.

5. **Bake in observability primitives**
   - Emit structured events and latency metrics at transport/app/integration boundaries.
   - Add correlation IDs across Redis and broker calls.
   - Success criteria: failures diagnosable without reading fallback behavior in code.

6. **Optimize hot path only after visibility exists**
   - Batch Redis operations, set explicit timeouts/retries, tune cache TTL and key design.
   - Success criteria: lower p95 latency and fewer dependency-amplified failures.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-1k users | Keep single serverless function; focus on policy correctness, auth, and structured telemetry. |
| 1k-100k users | Batch Redis commands, enforce dependency timeouts, isolate admin traffic from stream hot path. |
| 100k+ users | Split admin/telemetry ingestion from stream handler and consider dedicated worker pipelines for analytics. |

### Scaling Priorities

1. **First bottleneck:** Sequential Redis REST calls in policy and stream path; address via batched operations and reduced round-trips.
2. **Second bottleneck:** Broker and Redis long-tail latency; address via strict timeouts, bounded retries, and clearer degraded-mode responses.

## Anti-Patterns

### Anti-Pattern 1: God Handler Entrypoint

**What people do:** Keep routing, policy, integrations, HTML, and telemetry in one file/function.
**Why it's wrong:** Small edits create high regression risk and obscure failure ownership.
**Do this instead:** Maintain thin entrypoint composition and move each concern to explicit module boundaries.

### Anti-Pattern 2: Silent Fallbacks Without Reason Codes

**What people do:** Return empty streams on exceptions with no structured event.
**Why it's wrong:** Production incidents become non-reproducible and policy mistakes look like content misses.
**Do this instead:** Emit typed failure reason and correlation ID while still returning protocol-safe fallback.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Redis REST (Upstash/Vercel KV) | Single gateway adapter with command wrappers, timeouts, and optional batching | Primary state + telemetry store; protect credentials and validate response schema |
| Broker resolve API | Dedicated client with HTTPS-only output validation and abort timeout | Treat as unreliable dependency; map errors to safe fallback + observable code |
| `stremio-addon-sdk` | Adapter boundary in `domain/stremio-addon.js` | Preserve manifest/catalog/stream compatibility during all refactors |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `transport/router` ↔ `application/*` | Direct function calls with request context DTO | Transport should not import Redis/broker directly |
| `application/*` ↔ `integrations/*` | Adapter interface (`get/set`, `resolveEpisode`) | Keeps policy and stream logic testable with fakes |
| `application/*` ↔ `observability/*` | Event emit calls with shared schema | Consistent telemetry schema enables low-ops triage |

## Sources

- `C:/Users/enggy/Documents/GitHub/add-jipi/.planning/PROJECT.md`
- `C:/Users/enggy/Documents/GitHub/add-jipi/.planning/codebase/ARCHITECTURE.md`
- `C:/Users/enggy/Documents/GitHub/add-jipi/.planning/codebase/CONCERNS.md`

---
*Architecture research for: Stremio addon backend service*
*Researched: 2026-02-21*
