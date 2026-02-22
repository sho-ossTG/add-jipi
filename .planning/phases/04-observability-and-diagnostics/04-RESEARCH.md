# Phase 4: Observability and Diagnostics - Research

**Researched:** 2026-02-22
**Domain:** Correlated structured telemetry and operator-safe diagnostics for Node.js serverless Stremio addon backend
**Confidence:** HIGH

## Summary

Phase 4 should implement observability as a small, explicit telemetry layer in front of existing request/policy/dependency flows, not as ad-hoc logging in `catch` blocks. The current code already has clear reliability decisions and Redis counters (`stats:*`, `quarantine:events`), so the fastest path is to add correlation context and structured event schema around those existing control points.

For this stack, the standard approach is: request-scoped correlation ID (`AsyncLocalStorage`), structured JSON logs (`pino` child logger bindings), strict failure taxonomy, and operator-only diagnostic endpoints that expose aggregated status while redacting internals. This directly maps to OBSV-01/02/03 and preserves the existing operator authorization boundary from Phase 2.

**Primary recommendation:** Add a dedicated observability module that enforces correlation ID propagation + canonical failure classification + sanitized operator metrics endpoints, then lock behavior with contract tests.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `AsyncLocalStorage` (`node:async_hooks`) | Built-in (stable since Node 16.4) | Request-scoped correlation context across async boundaries | Official Node mechanism for coherent async request context; avoids manual parameter threading. |
| `pino` | `10.3.1` | Structured JSON logging with bindings/child loggers and redaction | Widely used Node logger; explicit bindings + redact support match correlation and sensitive-data requirements. |
| `crypto.randomUUID` (`node:crypto`) | Built-in | Correlation ID generation when caller does not supply one | Official built-in UUID generation; no extra package needed. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `prom-client` | `15.1.3` | Prometheus-format counters/histograms for operator scraping | Use if exposing `/operator/metrics` in Prometheus/OpenMetrics format instead of JSON-only metrics. |
| Upstash Redis REST (`/pipeline`, `/multi-exec`, `EVAL`) | Current API | Durable counters and low-volume event traces across serverless instances | Use for cross-instance reliability counters and operator diagnostics state. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pino` structured logs | `console.log` JSON objects | Works, but becomes hand-rolled logging/redaction policy; easier to drift and regress. |
| Redis-backed operator metrics | in-memory metrics only | Simpler, but serverless instance churn loses fidelity for fleet-level reliability metrics. |
| Full OpenTelemetry rollout in this phase | Targeted correlation + structured logs first | OTel is powerful but much larger scope; this phase goals are met without collector/exporter rollout. |

**Installation:**
```bash
npm install pino@10.3.1 prom-client@15.1.3
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── observability/
│   ├── context.js          # correlation ID lifecycle (extract/create/store)
│   ├── logger.js           # pino base logger + child helpers + redaction
│   ├── events.js           # canonical event taxonomy and emit helpers
│   ├── metrics.js          # reliability counters and health summarization
│   └── diagnostics.js      # operator-safe response shaping
├── handlers/
│   └── request.js          # route orchestration emitting observability events
└── server.js               # auth/cors/routing + operator-only diagnostics routes
```

### Pattern 1: Request-scoped correlation context
**What:** Create/accept `correlationId` once per request and propagate via async context.
**When to use:** Every inbound request path, including stream/manifest/health/operator endpoints.
**Example:**
```javascript
// Source: https://nodejs.org/api/async_context.html
const { AsyncLocalStorage } = require("node:async_hooks");
const { randomUUID } = require("node:crypto");

const requestContext = new AsyncLocalStorage();

function withRequestContext(req, run) {
  const incoming = String(req.headers["x-correlation-id"] || "").trim();
  const correlationId = incoming || randomUUID();
  return requestContext.run({ correlationId }, run);
}
```

### Pattern 2: Structured event taxonomy (single source of truth)
**What:** Emit all telemetry as typed events with fixed category and cause fields.
**When to use:** Request lifecycle, policy decisions, dependency calls, degraded/failure exits.
**Example:**
```javascript
// Source: https://raw.githubusercontent.com/pinojs/pino/main/docs/api.md
const logger = baseLogger.child({ component: "stream-handler" });

logger.info({
  event: "dependency.call.failed",
  category: "dependency",
  source: "redis",
  cause: "redis_http_error",
  correlationId,
  route: pathname
}, "Dependency call failed");
```

### Pattern 3: Operator-safe diagnostics projection
**What:** Separate internal telemetry from externally exposed diagnostics payload.
**When to use:** `/health/details`, `/quarantine`, and any new `/operator/*` diagnostics endpoints.
**Example:**
```javascript
// Source: repository pattern in serverless.js + OWASP logging guidance
function projectOperatorHealth(raw) {
  return {
    status: raw.ok ? "OK" : "DEGRADED",
    reliability: {
      broker_errors_total: Number(raw.brokerErrors || 0),
      redis_errors_total: Number(raw.redisErrors || 0),
      policy_blocks_total: Number(raw.policyBlocks || 0)
    },
    details: {
      // no IPs, tokens, stack traces, raw upstream URLs
      lastUpdated: raw.lastUpdated
    }
  };
}
```

### Anti-Patterns to Avoid
- **Correlation by optional best-effort fields:** if some events miss `correlationId`, end-to-end diagnosis breaks immediately.
- **Failure strings without canonical category/source:** free-form errors cannot satisfy OBSV-02 reliably.
- **Mixing public and operator diagnostics payloads:** increases accidental sensitive data exposure risk.
- **High-cardinality labels (IP, episodeId) in metrics:** causes storage/query blowups and noisy dashboards.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Async request context propagation | Manual `correlationId` threading through every function call | `AsyncLocalStorage` | Official context API is safer and less error-prone across async boundaries. |
| Structured JSON logger and redaction | Custom wrapper around `console.log` with manual masking | `pino` + `redact`/bindings/child loggers | Existing logging features cover redaction, stable shape, and context enrichment. |
| Prometheus exposition formatting | Custom `/metrics` string builder | `prom-client` registry output | Correct OpenMetrics/Prometheus formatting and metric semantics are already implemented. |
| Failure taxonomy inferred from arbitrary error text | Regex over error messages at query-time | Explicit category/source/cause schema at emit-time | Deterministic classification is required for operator diagnosis and contract tests. |

**Key insight:** observability quality here depends more on deterministic schema and context propagation than on volume of logs.

## Common Pitfalls

### Pitfall 1: Correlation ID context loss
**What goes wrong:** dependency/policy events log without request ID even though entry logs have one.
**Why it happens:** code escapes request async scope (callbacks, detached promises).
**How to avoid:** all request handling starts inside `AsyncLocalStorage.run`; test for presence of `correlationId` in each emitted event type.
**Warning signs:** operator cannot connect `request.received` to `dependency.call.failed` for the same failure.

### Pitfall 2: Taxonomy drift between teams/routes
**What goes wrong:** same failure appears as `redis_error`, `redis_fail`, `dependency_unavailable`.
**Why it happens:** event fields are ad-hoc per route/catch block.
**How to avoid:** central enum/table for `category`, `source`, and `cause`; reject unknown values in tests.
**Warning signs:** queries require many OR clauses for one conceptual failure source.

### Pitfall 3: Sensitive internals leak via diagnostics
**What goes wrong:** operator or public routes expose stack traces, tokens, raw IPs, or upstream URLs.
**Why it happens:** raw error/log objects serialized directly to response.
**How to avoid:** explicit response projection layer with allowlist fields only.
**Warning signs:** diagnostics responses include `err.stack`, `authorization`, `x-forwarded-for`, or full dependency URLs.

### Pitfall 4: Metrics with unbounded labels
**What goes wrong:** cardinality explosion and unusable dashboards.
**Why it happens:** labels include request IDs, IPs, episode IDs, user agent strings.
**How to avoid:** labels restricted to bounded dimensions (route, source, cause, result).
**Warning signs:** rapid growth in time series count after deploy.

### Pitfall 5: Over-instrumentation in hot path
**What goes wrong:** observability itself degrades latency.
**Why it happens:** heavy serialization, duplicated events, large payload logs per request.
**How to avoid:** emit compact structured events at major lifecycle points only.
**Warning signs:** p95 latency regression without dependency traffic change.

## Code Examples

Verified patterns from official sources:

### Async context for per-request correlation
```javascript
// Source: https://nodejs.org/api/async_context.html
const { AsyncLocalStorage } = require("node:async_hooks");
const store = new AsyncLocalStorage();

store.run({ correlationId: "req-123" }, async () => {
  await Promise.resolve();
  console.log(store.getStore().correlationId); // req-123
});
```

### Structured logger with child bindings
```javascript
// Source: https://raw.githubusercontent.com/pinojs/pino/main/docs/api.md
const pino = require("pino");
const logger = pino({ level: "info", redact: ["req.headers.authorization"] });
const reqLogger = logger.child({ correlationId: "req-123", route: "/stream" });
reqLogger.info({ event: "request.received" }, "Incoming request");
```

### Prometheus metrics endpoint emission
```javascript
// Source: https://raw.githubusercontent.com/siimon/prom-client/master/README.md
const client = require("prom-client");
const register = new client.Registry();
client.collectDefaultMetrics({ register });

async function handleMetrics(_req, res) {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ad-hoc text logs with weak cross-event linkage | Structured JSON logs with mandatory correlation ID and typed event schema | Matured Node logging ecosystem; modern structured logging defaults | Faster incident diagnosis and deterministic queries. |
| Per-instance implicit telemetry only | Operator-facing aggregated reliability metrics and safe diagnostics projection | Serverless operational practice shift toward explicit diagnostics endpoints | Operators can assess health without exposing internals. |
| Logging libraries with custom ad-hoc masking | First-class redaction/configurable serializers in mainstream loggers (`pino`) | Current pino API and ecosystem guidance | Reduces risk of accidental sensitive field leakage. |

**Deprecated/outdated:**
- Free-form error-message-only observability with no canonical cause taxonomy.
- Using high-cardinality dimensions (request IDs, IPs, raw episode IDs) as metric labels.

## Open Questions

1. **Canonical failure cause list depth**
   - What we know: must distinguish broker, Redis, validation, and policy failures.
   - What's unclear: whether planner wants sub-causes (e.g. `redis_timeout` vs `redis_response_error`) in phase scope.
   - Recommendation: lock top-level source categories now; allow optional sub-cause field without expanding required operator UI yet.

2. **Metrics transport shape for operators**
   - What we know: operator must query health and key reliability metrics safely.
   - What's unclear: JSON-only operator endpoint vs Prometheus/OpenMetrics endpoint in this phase.
   - Recommendation: implement JSON diagnostics as required baseline; add Prometheus endpoint only if monitoring stack already scrapes it.

## Sources

### Primary (HIGH confidence)
- `https://nodejs.org/api/async_context.html` - AsyncLocalStorage context propagation and usage guidance.
- `https://nodejs.org/api/diagnostics_channel.html` - diagnostics channel API and eventing model.
- `https://nodejs.org/api/crypto.html` - `crypto.randomUUID` availability in core runtime.
- `https://raw.githubusercontent.com/pinojs/pino/main/docs/api.md` - structured logging API, child bindings, redaction.
- `https://raw.githubusercontent.com/siimon/prom-client/master/README.md` - metrics registry/export patterns and metric types.
- `https://upstash.com/docs/redis/features/restapi` - Redis REST semantics, pipeline non-atomicity, transaction endpoint details.
- `https://prometheus.io/docs/practices/naming/` - metric naming and cardinality guidance.
- `https://prometheus.io/docs/practices/histograms/` - histogram vs summary guidance and aggregation tradeoffs.

### Secondary (MEDIUM confidence)
- `https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html` - secure logging and data exclusion guidance.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - based on official Node, pino, prom-client, Upstash, and Prometheus docs plus current repo stack.
- Architecture: HIGH - directly aligned to existing `serverless.js` flow and Node runtime capabilities.
- Pitfalls: HIGH - supported by official guidance and observed current code risks (ad-hoc event shape/sanitization boundaries).

**Research date:** 2026-02-22
**Valid until:** 2026-03-24
