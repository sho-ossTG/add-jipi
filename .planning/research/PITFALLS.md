# Pitfalls Research

**Domain:** Stremio stream-resolution addon backend (Node.js serverless) with Redis REST state and external broker dependency
**Researched:** 2026-02-21
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Treating fallback streams as successful resolution

**What goes wrong:**
The service returns protocol-safe fallback responses (empty/test stream) when broker or Redis calls fail, and the team interprets this as reliability instead of degraded correctness.

**Why it happens:**
Client compatibility pressure is high in addon backends, so teams optimize for "never break Stremio contract" and skip explicit failure classification.

**How to avoid:**
Define failure classes (`broker_timeout`, `broker_bad_payload`, `redis_unavailable`, `policy_block`) and always emit structured logs/metrics with correlation IDs, while still returning client-safe responses.

**Warning signs:**
Healthy-looking stream response rates with rising user complaints, growing `broker_error` counters without alerting, and incident reviews that cannot identify whether broker or Redis caused failures.

**Phase to address:**
Phase 2 - Stream-path reliability and dependency controls; Phase 3 - Observability and diagnostics

---

### Pitfall 2: Non-atomic Redis REST session gating

**What goes wrong:**
Session-slot checks and updates are done as separate Redis REST calls, enabling race conditions, slot leakage, or false rejections under concurrent load.

**Why it happens:**
REST-based Redis wrappers make each command feel simple, but distributed coordination requires atomicity and careful expiry semantics.

**How to avoid:**
Move slot allocation/release to Lua or transactional pipeline semantics, enforce idempotent keys per request/session, and test concurrency with burst scenarios before rollout.

**Warning signs:**
Intermittent `blocked:slot_taken` for valid users, active session counts that exceed configured caps, or keys expiring unpredictably after retries/redeploys.

**Phase to address:**
Phase 2 - Stream-path reliability and dependency controls

---

### Pitfall 3: Trusting client-provided forwarding headers for policy decisions

**What goes wrong:**
IP-based limiting/quarantine and telemetry are driven by spoofable `x-forwarded-for` values, allowing bypass and poisoning of operational data.

**Why it happens:**
In serverless deployments, teams assume proxy headers are sanitized everywhere and skip explicit trust-boundary enforcement.

**How to avoid:**
Accept forwarded headers only from trusted edge infra, use platform-provided client IP fields, and separate identity/rate-limiting keys from raw user-controlled headers.

**Warning signs:**
Rapid IP churn per user agent, impossible geo jumps, unexplained slot-usage spikes, and quarantine entries with malformed/multi-hop IP chains.

**Phase to address:**
Phase 1 - Surface security hardening

---

### Pitfall 4: Leaving operational endpoints and telemetry data publicly exposed

**What goes wrong:**
Routes like `/quarantine` leak IPs, episode IDs, and broker errors, creating privacy, abuse, and recon risks.

**Why it happens:**
Ops endpoints begin as debugging tools and remain open because they are "internal by convention" rather than protected by design.

**How to avoid:**
Require strong auth for admin routes, gate access by environment, redact sensitive fields in rendered output, and move detailed telemetry to protected logs/metrics backends.

**Warning signs:**
Unexpected public traffic to admin routes, copied screenshots containing user data, or incident channels using production endpoints as ad-hoc dashboards.

**Phase to address:**
Phase 1 - Surface security hardening

---

### Pitfall 5: No explicit timeout, retry budget, or circuit policy for broker/Redis calls

**What goes wrong:**
External calls hang until platform timeout, amplifying latency and exhausting serverless concurrency during provider slowness.

**Why it happens:**
`fetch` defaults appear acceptable at low traffic, and teams defer resilience policies until first outage.

**How to avoid:**
Use `AbortController` deadlines, bounded retries with jitter only for safe operations, circuit breaking on repeated failures, and clear per-dependency latency/error SLOs.

**Warning signs:**
P95/P99 latency cliffs during broker instability, rising function duration and timeout rates, and recovery requiring manual redeploy instead of auto-heal.

**Phase to address:**
Phase 2 - Stream-path reliability and dependency controls

---

### Pitfall 6: Tight coupling of routing, policy, rendering, and integrations in one handler

**What goes wrong:**
A single entrypoint change regresses unrelated behavior, and hardening work stalls because each edit has broad blast radius.

**Why it happens:**
Small addons start as one file for speed, then accumulate policy and ops features without modular boundaries.

**How to avoid:**
Refactor to modules (`routing`, `policy`, `redis-store`, `broker-client`, `admin-view`, `response-shaping`), preserve thin composition at entrypoint, and add contracts between modules.

**Warning signs:**
Large PRs touching many unrelated branches, frequent merge conflicts in one file, and bug fixes repeatedly breaking health/admin/stream paths.

**Phase to address:**
Phase 4 - Modularization and maintainability

---

### Pitfall 7: Shipping without contract and failure-mode tests

**What goes wrong:**
Changes that appear safe break Stremio manifest/stream contracts or alter edge-case policy behavior (time windows, slot handling) in production.

**Why it happens:**
Serverless addons often rely on manual endpoint checks; integration failures are hard to reproduce and are deferred.

**How to avoid:**
Add test suites for Stremio contract responses, broker malformed payloads, Redis failure fallbacks, and deterministic time-window boundaries using fixed clocks.

**Warning signs:**
Frequent "works locally" incidents, emergency rollbacks after minor refactors, and inability to assert behavior for 00:00/01:00/08:00 boundary cases.

**Phase to address:**
Phase 4 - Modularization and maintainability

---

### Pitfall 8: Dependency drift without lockfile and compatibility gates

**What goes wrong:**
Unpinned dependency updates (especially addon SDK/runtime libs) change behavior across deploys, causing non-deterministic regressions.

**Why it happens:**
Early-stage services skip lockfiles and release checks to move quickly.

**How to avoid:**
Commit lockfile, set dependency update policy, and run compatibility tests for manifest/catalog/stream handlers on each dependency bump.

**Warning signs:**
Behavior changes with no code diff, environment-specific inconsistencies, and post-deploy incidents tied to fresh install/builds.

**Phase to address:**
Phase 4 - Modularization and maintainability

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keep all logic in `serverless.js` | Fast edits for urgent fixes | Growing blast radius and slower incident response | Only temporary in first stabilization sprint |
| Add silent `catch` + fallback only | Avoids visible client errors | Root cause blindness and repeated outages | Never |
| Store free-form JSON strings for quarantine events | Minimal schema overhead | HTML injection risk, parsing failures, weak analytics | Only with strict schema validation and output escaping |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Broker resolve API | Assuming payload is always valid HTTPS URL | Validate schema and protocol, classify errors, and quarantine bad payloads safely |
| Redis REST | Treating sequential commands as equivalent to atomic operations | Use Lua/transaction patterns for session gating and idempotent writes |
| Serverless edge/proxy | Trusting raw forwarded headers for identity and controls | Trust only platform-sanitized client IP and enforce trusted proxy boundaries |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Many sequential Redis REST round trips per stream request | Latency variance, slot-check delays, timeouts under bursts | Batch commands and minimize hot-path reads/writes | Burst traffic and moderate concurrency |
| Rendering full admin HTML table on each request | Increased CPU time and response lag on diagnostics route | Cache or expose JSON API and paginate client-side | Frequent operational access during incidents |
| Dependency calls sharing same timeout budget as full request | End-to-end timeout exhaustion and retry storms | Separate per-call deadlines and global request budget | Provider degradation windows |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Public quarantine/admin telemetry routes | Data leakage (IPs/content IDs), recon for abuse | Strong authn/authz, environment gating, and field redaction |
| Unescaped rendering of broker/error data in HTML | Stored/reflected XSS in operational pages | Centralized output escaping and strict content sanitization |
| Global wildcard CORS on operational JSON | Unnecessary cross-origin exposure of internals | Route-level CORS with explicit allowlist |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Generic empty stream for all failures | Users cannot distinguish temporary outage from unsupported content | Keep safe fallback but encode machine-readable reason for ops, and improve client-facing consistency |
| Aggressive global slot cap without context | Legitimate users blocked during short bursts | Adaptive policy (per-IP/token bucket/global cap) with clear quarantine/retry behavior |
| Flaky availability window behavior at timezone boundaries | "Sometimes works" perception and trust erosion | Deterministic time logic with tested boundary cases and clear status signaling |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Timeouts added:** Also verify retry caps, jitter, and cancellation propagation across broker + Redis calls.
- [ ] **Admin route protected:** Also verify data redaction and cache-control/no-store behavior.
- [ ] **Session limit works:** Also verify race safety under concurrent requests and key expiry correctness.
- [ ] **Fallback still returned:** Also verify failure classification and alerting signal are emitted.

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Silent failure masking | MEDIUM | Backfill structured logs, add temporary high-cardinality tracing in stream path, replay recent failures from quarantine events |
| Session race/slot corruption | HIGH | Disable strict slot enforcement temporarily, clear/rebuild affected Redis keys safely, deploy atomic gating hotfix |
| Public admin exposure | HIGH | Immediately gate route at edge, rotate related credentials if leaked context suggests risk, purge sensitive retained telemetry |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Fallback treated as success | Phase 2 and Phase 3 | Error class metrics and correlation IDs visible; alerts fire on broker/redis failure thresholds |
| Non-atomic Redis gating | Phase 2 | Concurrency tests show no slot oversubscription or false rejects under burst load |
| Spoofable forwarded headers | Phase 1 | Requests with forged headers do not alter identity/quarantine attribution |
| Public operational endpoints | Phase 1 | Unauthorized callers cannot access admin routes in production |
| Missing timeout/retry/circuit policies | Phase 2 | Dependency latency is bounded and timeout rate no longer cascades during provider slowness |
| Monolithic handler coupling | Phase 4 | Module-level tests pass independently and PR blast radius decreases |
| No contract/failure-mode tests | Phase 4 | CI validates manifest/catalog/stream contracts and edge-case policies |
| Dependency drift | Phase 4 | Lockfile committed; dependency updates require passing compatibility suite |

## Sources

- `/.planning/PROJECT.md` (project requirements, constraints, and milestone context)
- `/.planning/codebase/CONCERNS.md` (current failure modes, security gaps, test gaps, and scaling risks)
- `/.planning/codebase/INTEGRATIONS.md` (broker/Redis/serverless dependency model)

---
*Pitfalls research for: Stremio stream-resolution addon backend with Redis and broker dependencies*
*Researched: 2026-02-21*
