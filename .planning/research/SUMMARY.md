# Project Research Summary

**Project:** add-jipi
**Domain:** Stremio addon backend (serverless stream resolver with Redis + broker dependencies)
**Researched:** 2026-02-21
**Confidence:** MEDIUM-HIGH

## Executive Summary

This is a brownfield production-hardening effort for a Stremio addon backend where the core product already exists, but reliability, security, and maintainability are below production expectations. Across all research tracks, the consistent expert pattern is: keep manifest/catalog/stream protocol compatibility stable, then isolate risk-heavy concerns (policy, integrations, admin surfaces, telemetry) behind explicit module boundaries instead of continuing with a monolithic handler.

The recommended build path is opinionated and incremental: run on Node 24 LTS with Fastify 5 and a pinned `stremio-addon-sdk`, move Redis/broker calls into bounded adapters, implement atomic session gating, and treat fallback responses as degraded outcomes that are observable (typed reason codes + correlation IDs) rather than silent success. Launch scope should prioritize secure ops surfaces, reliable stream-path controls, and diagnosable failures; differentiators like dry-run policy simulation and richer SLO dashboards come after baseline stability.

The primary risks are already known and avoidable: spoofable trust identity, public operational data exposure, non-atomic Redis controls under concurrency, and latency cascades from unbounded dependency calls. Mitigation order is clear from dependencies: secure surface first, reliability second, observability third, and deep modularization/test governance fourth.

## Key Findings

### Recommended Stack

`STACK.md` recommends a modern but conservative serverless Node stack with clear compatibility gates.

**Core technologies:**
- **Node.js 24 LTS:** runtime baseline with long support window and first-class abort/timeout primitives for dependency control.
- **Fastify 5.x:** modular routing and plugin boundaries suitable for splitting transport/policy/integrations cleanly.
- **stremio-addon-sdk 1.6.x (exact pin):** compatibility anchor for Stremio contracts during refactors.
- **@upstash/redis 1.x + @upstash/ratelimit 2.x:** serverless-native Redis REST access and admission throttling.
- **OpenTelemetry JS + Sentry Node SDK:** correlated traces/errors/metrics for cross-layer incident diagnosis.

Critical version constraints: Node >=20 (target 24 LTS), Fastify 5.x, Vitest 4.x, exact `stremio-addon-sdk` pin, and lockfile-backed dependency governance.

### Expected Features

`FEATURES.md` confirms a launch-focused feature set centered on secure operations and reliable stream delivery.

**Must have (table stakes):**
- Stable Stremio `manifest`/`catalog`/`stream` contract with compatibility tests.
- Reliable episode resolution with bounded dependency behavior and safe fallback semantics.
- Correct Redis-backed admission/session control with atomic semantics under concurrency.
- Secure admin/health diagnostics with auth, trust boundaries, and redacted outputs.
- Deterministic failure handling with protocol-safe client responses plus internal typed reasons.

**Should have (competitive):**
- Degraded-mode transparency via failure taxonomy and correlation IDs.
- Explicit timeout/retry/circuit resilience policies per dependency.
- Modular backend boundaries that reduce blast radius and speed safe changes.
- First-class operational telemetry and later policy dry-run diagnostics.

**Defer (v2+):**
- New content-domain expansion beyond current ID scope.
- Multi-tenant account/billing capabilities.

### Architecture Approach

`ARCHITECTURE.md` defines a layered service model: thin `entry/transport` routing and guards, `application` services for policy/stream/admin orchestration, `integrations` for Redis and broker adapters, `domain` for Stremio contract shaping, and `observability` as a first-class boundary. Key patterns are intercept-and-delegate routing, typed policy decision objects, and bounded integration adapters with timeout/validation/error normalization.

**Major components:**
1. `transport` + `entry` - path dispatch, auth/CORS/trust guards, protocol-safe response shaping.
2. `application` services - policy decisions, stream orchestration, admin diagnostics aggregation.
3. `integrations` adapters - Redis gateway and broker client with bounded/typed external call behavior.
4. `domain` boundary - Stremio contract wrappers and stream DTO normalization.
5. `observability` - structured events, latency/counter metrics, correlation ID propagation.

### Critical Pitfalls

1. **Fallback treated as success** - keep client-safe fallback, but emit typed failure classes and correlation IDs every time.
2. **Non-atomic Redis gating** - implement atomic slot/session semantics and stress test concurrent bursts.
3. **Spoofable forwarded-header trust** - trust only platform-sanitized identity and hardened proxy boundaries.
4. **Public admin/quarantine exposure** - require strong auth, environment gates, and sensitive-field redaction.
5. **No timeout/retry/circuit policy** - enforce per-call deadlines, bounded retries, and clear degrade rules to avoid latency cascades.

## Implications for Roadmap

Based on combined research, suggested phase structure:

### Phase 1: Security Boundary Hardening
**Rationale:** Security defects are immediate production risk and a prerequisite for safe diagnostics and policy attribution.
**Delivers:** Trusted identity handling, admin authn/authz, route-scoped CORS, redacted operational outputs.
**Addresses:** Table-stakes secure operational surfaces and deterministic request attribution.
**Avoids:** Spoofed-header abuse and public telemetry leakage pitfalls.

### Phase 2: Stream-Path Reliability and Admission Correctness
**Rationale:** Core product value is playable streams under load; dependency and Redis correctness are the largest outage multipliers.
**Delivers:** Atomic session gating, bounded broker/Redis call policies, typed dependency failure model.
**Uses:** Node timeout/abort primitives, Upstash Redis + ratelimit tooling, adapter-based integration boundaries.
**Implements:** `application/policy-engine`, `application/stream-service`, `integrations/*` hot-path controls.

### Phase 3: Observability and Degraded-Mode Transparency
**Rationale:** Reliability controls are only useful if teams can detect, classify, and alert on degradation quickly.
**Delivers:** Correlation IDs, structured outcome schema, dependency latency/error metrics, initial SLO-driven alerting.
**Addresses:** Differentiator goals for degraded-mode transparency and operator diagnostics quality.
**Avoids:** Silent failure masking and low-signal incident response.

### Phase 4: Modularization, Test Governance, and Dependency Hygiene
**Rationale:** After risk controls are in place, complete the architecture split and enforce long-term change safety.
**Delivers:** Full modular boundaries, contract/failure-mode/concurrency tests, lockfile + update gates.
**Addresses:** Maintainability differentiator and stable delivery velocity.
**Avoids:** God-handler regressions, contract drift, and dependency drift incidents.

### Phase 5: Operator Experience Enhancements (v1.x)
**Rationale:** Higher-order tools should follow verified telemetry and stable policies.
**Delivers:** Policy dry-run diagnostics and tuned SLO dashboards.
**Addresses:** Should-have differentiators that improve operational confidence.
**Avoids:** Premature complexity before core reliability/security targets hold.

### Phase Ordering Rationale

- Security precedes everything because exposed ops surfaces and spoofable identity are immediate abuse/privacy liabilities.
- Reliability controls come before observability maturity because there must be stable policy/dependency behavior to measure.
- Observability precedes full optimization and ops UX so decisions are data-driven, not anecdotal.
- Modularization/testing consolidates gains and prevents regression loops as velocity increases.
- v2 scope expansion is intentionally deferred until launch SLOs and operational safeguards are consistently met.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2:** Redis REST atomicity implementation strategy under current provider/runtime constraints and broker timeout budget tuning.
- **Phase 3:** Telemetry cardinality/retention thresholds and alert design for serverless cost-performance balance.
- **Phase 5:** Safe operator tooling ergonomics for policy simulation without introducing new exposure risks.

Phases with standard patterns (skip research-phase):
- **Phase 1:** Admin auth, trust-boundary, and route-level CORS/redaction controls are mature and well-documented.
- **Phase 4:** Modular refactor patterns, Node contract testing, and lockfile governance are standard engineering practices.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Backed by official docs with explicit runtime/version compatibility and serverless-fit rationale. |
| Features | MEDIUM | Well-structured and actionable, but primarily derived from internal artifacts rather than external benchmark evidence. |
| Architecture | HIGH | Detailed boundaries, data flow, and incremental build order are concrete and internally consistent. |
| Pitfalls | HIGH | Domain-specific failure modes are precise, preventive actions are clear, and phase mapping is practical. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Redis atomic semantics details:** Validate exact Lua/transaction feasibility and fallback strategy in current Redis REST environment before final phase scoping.
- **SLO thresholds and alert budgets:** Calibrate with baseline production traffic to avoid noisy or blind monitoring.
- **Policy simulation guardrails:** Define access controls and redaction requirements before shipping dry-run tooling.

## Sources

### Primary (HIGH confidence)
- `.planning/research/STACK.md`
- `.planning/research/FEATURES.md`
- `.planning/research/ARCHITECTURE.md`
- `.planning/research/PITFALLS.md`
- https://nodejs.org/en/about/previous-releases - Node LTS lifecycle and runtime support guidance.
- https://fastify.dev/docs/latest/Reference/LTS/ - Fastify support model and Node compatibility.
- https://upstash.com/docs/redis/sdks/ts/overview - Upstash Redis client recommendations for serverless.
- https://upstash.com/docs/redis/sdks/ratelimit-ts/overview - serverless rate-limiting patterns.
- https://docs.sentry.io/platforms/javascript/guides/node/ - Node error monitoring/instrumentation guidance.

### Secondary (MEDIUM confidence)
- https://opentelemetry.io/docs/languages/js/ - OpenTelemetry JS instrumentation patterns.
- https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static - timeout primitive for bounded external calls.
- https://www.npmjs.com/package/stremio-addon-sdk - package state/version recency context.
- `.planning/PROJECT.md`
- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/CONCERNS.md`

---
*Research completed: 2026-02-21*
*Ready for roadmap: yes*
