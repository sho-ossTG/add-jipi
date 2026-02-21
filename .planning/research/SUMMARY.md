# Project Research Summary

**Project:** add-jipi
**Domain:** Stremio addon backend (serverless stream resolver with Redis + broker dependencies)
**Researched:** 2026-02-21
**Confidence:** MEDIUM

## Executive Summary

This project is a brownfield hardening effort for a Stremio addon backend, not a net-new product build. Expert practice in this domain is to keep Stremio protocol behavior stable while isolating high-risk concerns (policy, dependency calls, admin surfaces, observability) behind clear module boundaries. The research strongly supports an incremental architecture split over a rewrite: preserve manifest/catalog/stream compatibility first, then harden security and reliability controls around Redis and broker integrations.

The recommended approach is a Node 24 LTS + Fastify 5 modular serverless architecture, retaining `stremio-addon-sdk` at a pinned 1.6.x version and replacing ad-hoc Redis REST logic with maintained Upstash clients plus explicit rate limiting. Operationally, the system should treat fallback responses as degraded outcomes (not silent success), with typed failure classes, structured telemetry, and strict timeout/retry budgets on all external calls.

The highest risks are public operational data exposure, spoofable request identity, non-atomic session gating in Redis REST, and hidden dependency failure modes masked by safe fallbacks. Mitigation is phaseable: secure surface and trust boundaries first, then implement bounded dependency behavior and atomic gating, then add first-class observability, and only then optimize/expand features.

## Key Findings

### Recommended Stack

Stack research recommends a modern but conservative runtime baseline that minimizes operational surprises in serverless deployment while preserving current addon compatibility.

**Core technologies:**
- **Node.js 24 LTS:** runtime baseline with long support window and modern built-in APIs (`fetch`, abort/timeout patterns).
- **Fastify 5.x:** high-performance HTTP routing with clean plugin boundaries for modularization.
- **stremio-addon-sdk 1.6.x (exact pin):** protocol compatibility anchor during hardening.
- **@upstash/redis 1.x + @upstash/ratelimit 2.x:** serverless-native Redis REST/state and admission control.
- **OpenTelemetry JS + Sentry Node SDK:** correlated diagnostics across transport, policy, Redis, and broker paths.

Critical version constraints: keep Node >=20 (target 24 LTS), Fastify 5.x, Vitest 4.x, and pin exact `stremio-addon-sdk` to avoid contract drift.

### Expected Features

`FEATURES.md` is missing, so feature confidence is currently low and roadmap feature mapping is inferred from `PROJECT.md` and architecture/pitfall context.

**Must have (table stakes):**
- Stremio manifest/catalog/stream contract stability.
- Broker-based episode resolution with protocol-safe fallback behavior.
- Redis-backed session/admission controls with reliable correctness under concurrency.
- Protected health/admin diagnostics (no public sensitive telemetry exposure).

**Should have (competitive):**
- Failure-class observability with correlation IDs and dependency-level latency/error signals.
- Degraded-mode transparency for operators while keeping client-safe responses.
- Modular code boundaries that reduce blast radius and speed incident response.

**Defer (v2+):**
- Major product-scope expansion (new content domains, tenancy/billing, non-backend client work).
- Analytics-heavy pipelines beyond core operational telemetry.

### Architecture Approach

Architecture research is clear: keep a thin serverless entrypoint and split concerns into transport, application, integrations, domain, and observability modules. Use intercept-and-delegate routing for custom high-risk paths (`/stream`, admin/health), typed policy decision objects, and integration adapters that enforce timeout/validation/error normalization before any data reaches response shaping.

**Major components:**
1. `transport` + `entry` — route dispatch, auth/CORS/trust guards, response shaping.
2. `application` services — policy evaluation, stream orchestration, admin diagnostics aggregation.
3. `integrations` adapters — Redis gateway and broker client with bounded calls and normalized failures.
4. `domain` contract boundary — Stremio payload compatibility and stream DTO validation.
5. `observability` — structured events, counters, and latency/correlation instrumentation.

### Critical Pitfalls

1. **Fallback treated as success** — keep fallback for compatibility, but always emit typed failure reasons and correlation IDs.
2. **Non-atomic Redis gating** — move slot/session logic to atomic semantics (Lua/transaction style) and validate under burst concurrency.
3. **Spoofable forwarded-header trust** — only trust platform-sanitized client identity and strict proxy boundaries.
4. **Public admin/quarantine exposure** — enforce strong auth, environment gating, and sensitive-field redaction.
5. **Unbounded dependency calls** — apply per-call deadlines, bounded retry budgets, and circuit/degraded-mode policies.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Surface Security Hardening
**Rationale:** Security boundary defects (spoofable identity + public ops data) are immediate risk and prerequisite for safe diagnostics.
**Delivers:** Trusted request identity policy, admin authn/authz, route-level CORS, redacted admin outputs.
**Addresses:** Protected diagnostics and reliable policy attribution.
**Avoids:** Header spoofing and public telemetry exposure pitfalls.

### Phase 2: Stream-Path Reliability Controls
**Rationale:** Core user value is reliable stream resolution; dependency and state correctness issues are next highest outage drivers.
**Delivers:** Atomic Redis slot/session gating, timeout/retry/circuit policy for broker+Redis, normalized dependency error classes.
**Uses:** Node abort primitives, Upstash clients/ratelimit, bounded adapter patterns.
**Implements:** Policy engine + integration adapters in the main stream flow.

### Phase 3: Observability and Diagnostics Maturity
**Rationale:** Once reliability controls exist, observability must prove they work and support fast incident triage.
**Delivers:** Structured telemetry schema, correlation IDs, latency/error dashboards, actionable alerts.
**Addresses:** Distinguishing degraded fallback from true success.
**Avoids:** Silent failure masking and low-signal incident response.

### Phase 4: Modularization, Contracts, and Maintainability
**Rationale:** With security/reliability/visibility foundations in place, complete architecture split and enforce change safety.
**Delivers:** Full module boundaries (transport/application/integrations/domain/observability), contract and failure-mode test suites, lockfile + dependency update gates.
**Addresses:** Maintainable velocity without regressions.
**Avoids:** God-handler coupling, contract breakage, and dependency drift.

### Phase Ordering Rationale

- Security-first ordering removes active abuse/data-leak risk before adding richer operational surfaces.
- Reliability second addresses highest-probability service degradation in the stream hot path.
- Observability third ensures controls are measurable and incident diagnosis is low-friction.
- Modularization/test gates last cements long-term delivery speed and prevents regression loops.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2:** Redis REST atomicity patterns under provider constraints (Lua/transactions/pipeline semantics) and broker SLO tuning.
- **Phase 3:** Alert thresholds/cardinality strategy for high-volume telemetry in serverless cost envelopes.

Phases with standard patterns (skip research-phase):
- **Phase 1:** Admin route auth/CORS/trust-boundary hardening is well-documented and implementation-standard.
- **Phase 4:** Modular refactor + test harness + lockfile governance follows established Node service practices.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Strong official-source backing (Node/Fastify/Upstash/Sentry/Vitest) and clear compatibility guidance. |
| Features | LOW | `FEATURES.md` was not available; feature set inferred from `PROJECT.md` and other research artifacts. |
| Architecture | HIGH | Detailed component boundaries, patterns, and build order are concrete and internally consistent. |
| Pitfalls | HIGH | Domain-specific pitfalls are actionable, phase-mapped, and tightly aligned with current concerns. |

**Overall confidence:** MEDIUM

### Gaps to Address

- **Missing feature research artifact:** Create `FEATURES.md` before roadmap finalization to confirm must/should/defer scope explicitly.
- **Redis atomicity implementation detail:** Validate exact command strategy supported by current Redis REST setup in a focused phase research task.
- **Telemetry operating thresholds:** Define alert/error budgets with baseline traffic data to avoid noisy or blind monitoring.

## Sources

### Primary (HIGH confidence)
- https://nodejs.org/en/about/previous-releases — Node LTS lifecycle and runtime support guidance.
- https://fastify.dev/docs/latest/Reference/LTS/ — Fastify support model and Node compatibility.
- https://upstash.com/docs/redis/sdks/ts/overview — Upstash Redis client recommendations for serverless.
- https://upstash.com/docs/redis/sdks/ratelimit-ts/overview — Serverless rate-limiting patterns.
- https://docs.sentry.io/platforms/javascript/guides/node/ — Node error monitoring/instrumentation guidance.

### Secondary (MEDIUM confidence)
- https://opentelemetry.io/docs/languages/js/ — OTel JS instrumentation patterns.
- https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static — timeout primitive for bounded external calls.
- https://www.npmjs.com/package/stremio-addon-sdk — package state/version recency context.

### Project context artifacts
- `.planning/research/STACK.md`
- `.planning/research/ARCHITECTURE.md`
- `.planning/research/PITFALLS.md`
- `.planning/PROJECT.md`

---
*Research completed: 2026-02-21*
*Ready for roadmap: yes (with feature-scope gap noted)*
