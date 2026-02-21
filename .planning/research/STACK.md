# Stack Research

**Domain:** Stremio addon backend (Node.js serverless, broker + Redis REST)
**Researched:** 2026-02-21
**Confidence:** MEDIUM-HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 24 LTS | Runtime baseline for all functions | Current Active LTS for production, better long-term security window than unpinned Node or older EOL lines. Better default `fetch`/Abort APIs for bounded upstream calls. **Confidence: HIGH** |
| Fastify | 5.x | HTTP entrypoint, routing, hooks, lifecycle, plugin boundaries | Better fit than monolithic handler + manual branching: strict plugin boundaries, strong perf profile, and mature security/plugin ecosystem for production Node APIs. **Confidence: HIGH** |
| stremio-addon-sdk | 1.6.x (pin exact) | Stremio manifest/catalog/stream contract | Keep protocol compatibility while isolating SDK use into a dedicated adapter module; do not rewrite protocol layer during hardening phase. **Confidence: HIGH** |
| @upstash/redis | 1.x | Redis REST client for state/session/metrics | Replaces handwritten REST command glue with maintained connectionless client designed for serverless and HTTP runtimes; lowers integration risk and boilerplate errors. **Confidence: HIGH** |
| @upstash/ratelimit | 2.x | Admission control and abuse throttling | Serverless-first, Redis-backed rate limiting with caching/timeout features; better than ad-hoc slot checks for abuse resilience. **Confidence: HIGH** |
| OpenTelemetry JS + OTLP exporter | 1.x + 0.5x instrumentation | Traces/metrics/log correlation across request, broker, and Redis calls | Standardized observability model; enables incident diagnosis without coupling to one vendor and supports serverless patterns. **Confidence: MEDIUM** |
| Sentry Node SDK | 10.x | Error monitoring, tracing, release health | Faster incident triage than Redis-only quarantine logs; catches exceptions and degraded paths with stack context and sampling controls. **Confidence: HIGH** |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino + pino-http | 10.x / 11.x | Structured JSON logging with request context | Default logger for all request paths; use redaction and child loggers for broker/Redis context. |
| zod | 4.x | Input/env/runtime schema validation | Validate route params, query, headers, and external API payloads at boundaries. |
| jose | 5.x or 6.x | Signed admin access (JWT/JWS) for protected operational routes | Use for `/health`/admin/quarantine auth instead of public endpoints or static secrets in query strings. |
| p-retry | 6.x | Bounded retries with backoff for transient upstream failures | Wrap idempotent broker/Redis reads only; never retry unsafe writes blindly. |
| @fastify/helmet + @fastify/cors | 12.x / 10.x | Security headers and strict CORS policy | Apply route-specific policies; keep Stremio endpoints permissive only where required by protocol. |
| @fastify/under-pressure | 9.x | Overload protection and health signal under stress | Shed load safely when broker/Redis latency spikes to protect core stream path. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Vitest 4.x | Unit/integration test runner | Node >=20, fast feedback loop; add contract tests for Stremio responses and fallback behavior. |
| ESLint 9.x + @eslint/js | Static analysis and consistency | Enforce no-empty-catch, no-floating-promises, and security-focused lint rules. |
| npm lockfile + Dependabot/Renovate | Supply-chain control and predictable deploys | Current repo has no lockfile; pin exact transitive graph and automate safe updates. |

## Installation

```bash
# Core
npm install fastify stremio-addon-sdk @upstash/redis @upstash/ratelimit @sentry/node pino pino-http zod jose p-retry @fastify/helmet @fastify/cors @fastify/under-pressure

# Dev dependencies
npm install -D vitest eslint @eslint/js
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Fastify 5.x | Express 5.x | Use Express only if team already has heavy Express middleware investment; otherwise Fastify is cleaner for new modular boundaries and better perf default. |
| Upstash client + ratelimit libs | Manual `fetch` Redis REST wrappers | Only keep manual wrappers for very short-lived prototypes; production needs typed client, retries, and consistent error handling. |
| OTel + Sentry | Vendor-only logging dashboard without traces | Acceptable for tiny hobby add-ons; not enough for diagnosing multi-hop broker/Redis latency and fallback masking in production. |
| Signed admin endpoints (jose) | Public diagnostics routes | Public diagnostics may be tolerable only in local/dev; never for Internet-facing production. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Single-file serverless handler owning routing, policy, integrations, and HTML | Causes fragile coupling and regression-prone edits; already visible in current `serverless.js` concerns | Fastify plugin modules: `routes/`, `policy/`, `integrations/`, `observability/` |
| Unbounded external fetch calls (no timeout/abort) | Can exhaust concurrency and amplify broker/Redis incidents | `AbortSignal.timeout(...)` + bounded retry budget + circuit/open-state guard |
| Open `/quarantine`-style operational surfaces | Leaks IPs/internal failure data and enables reconnaissance | Authenticated admin API + external observability tooling |
| No lockfile / loose runtime pinning | Non-reproducible deploys and surprise dependency breakage | Commit `package-lock.json`, pin Node major, controlled update cadence |

## Stack Patterns by Variant

**If staying on Vercel serverless (current constraint):**
- Keep Node.js runtime + Fastify in serverless entry.
- Use Upstash REST clients (`@upstash/redis`, `@upstash/ratelimit`) and avoid TCP-only Redis clients.
- Export telemetry via OTLP/Sentry with low overhead sampling on hot stream routes.

**If traffic grows beyond single-function comfort (higher QPS, strict SLO):**
- Split into two deployables: `addon-public-api` (manifest/catalog/stream) and `ops-api` (health/admin).
- Keep Redis as control plane but isolate admission/rate-limit keys from telemetry/event keys.
- Add queue-backed event pipeline for quarantine/audit writes so stream path stays latency-first.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| fastify@5.x | node@20+ | Fastify v5 line targets modern Node LTS lines; align with Node 24 LTS target. |
| vitest@4.x | node@20+ | Matches modern runtime baseline and avoids maintaining old Node shims. |
| stremio-addon-sdk@1.6.x | Node CommonJS projects | Package is mature but relatively old; pin exact version and add contract tests before upgrades. |

## Sources

- https://nodejs.org/en/about/previous-releases — Active/Maintenance LTS status and production guidance. **Confidence: HIGH**
- https://fastify.dev/docs/latest/Reference/LTS/ — Fastify support model and Node compatibility policy. **Confidence: HIGH**
- https://upstash.com/docs/redis/sdks/ts/overview — Upstash Redis TypeScript/HTTP client positioning for serverless runtimes. **Confidence: HIGH**
- https://upstash.com/docs/redis/sdks/ratelimit-ts/overview — Rate limit features (serverless-first, timeout, multi-region). **Confidence: HIGH**
- https://docs.sentry.io/platforms/javascript/guides/node/ — Node SDK requirements and production instrumentation model. **Confidence: HIGH**
- https://vitest.dev/guide/ — Vitest v4 current docs and Node requirement. **Confidence: HIGH**
- https://zod.dev/ — Zod 4 stable status and runtime validation capabilities. **Confidence: HIGH**
- https://www.npmjs.com/package/stremio-addon-sdk — Current package state/version recency for risk assessment. **Confidence: MEDIUM**
- https://opentelemetry.io/docs/languages/js/ — OpenTelemetry JS as the standard instrumentation ecosystem. **Confidence: MEDIUM**
- https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static — Timeout primitive for bounded fetch calls. **Confidence: MEDIUM**

---
*Stack research for: Stremio addon backend hardening/scaling*
*Researched: 2026-02-21*
