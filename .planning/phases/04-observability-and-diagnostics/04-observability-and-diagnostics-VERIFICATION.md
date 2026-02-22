---
phase: 04-observability-and-diagnostics
verified: 2026-02-22T10:42:49.439Z
status: gaps_found
score: 6/7 must-haves verified
gaps:
  - truth: "Operator health and metrics diagnostics are both projected through shared sanitization helpers"
    status: partial
    reason: "`/operator/metrics` uses `projectOperatorMetrics`, but `/health/details` bypasses `observability/diagnostics.js` and returns inline JSON."
    artifacts:
      - path: "serverless.js"
        issue: "`/health/details` branch sends direct payloads instead of using diagnostics projection helper"
      - path: "observability/diagnostics.js"
        issue: "`projectOperatorHealth` exists but is not wired into request handling"
    missing:
      - "Use `projectOperatorHealth(...)` (or equivalent shared projector) in `/health/details` success/failure responses"
      - "Keep `/health/details` payload contract intentionally aligned with projector output (and lock with contract test)"
---

# Phase 4: Observability and Diagnostics Verification Report

**Phase Goal:** Operators can quickly diagnose failed or degraded behavior through correlated, structured, and safely exposed telemetry.
**Verified:** 2026-02-22T10:42:49.439Z
**Status:** gaps_found
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Every request path emits a correlation ID operators can follow across request, policy, dependency, and completion events. | ✓ VERIFIED | Request context wrapping + correlation header binding in `serverless.js:959`, `serverless.js:960`, completion correlation in `serverless.js:1125`; contract lock in `tests/contract-observability.test.js:159`. |
| 2 | Failure telemetry uses deterministic structured fields classifying broker, redis, validation, policy sources. | ✓ VERIFIED | Canonical classifier/builder in `observability/events.js:51`, `observability/events.js:92`; dependency and policy emissions in `serverless.js:604`, `serverless.js:615`, `serverless.js:786`; contract assertions in `tests/contract-observability.test.js:207`. |
| 3 | Correlated telemetry remains structured JSON and avoids ad-hoc parsing. | ✓ VERIFIED | Centralized event emission path `emitTelemetry -> emitEvent` in `serverless.js:70` and `serverless.js:71`; pino/fallback JSON logger in `observability/logger.js:38` and `observability/logger.js:24`. |
| 4 | Operators can query health and reliability metrics summarizing failures by source without raw internals. | ✓ VERIFIED | Token-gated `/operator/metrics` route reads Redis summary and projects payload in `serverless.js:1034`, `serverless.js:1037`, `serverless.js:1039`; metrics dimensions are bounded in `observability/metrics.js:7`. |
| 5 | Operator diagnostics endpoints remain token-gated and do not leak IPs, tokens, stack traces, or raw upstream URLs. | ✓ VERIFIED | Operator auth gate in `serverless.js:989`; security contracts for deny/allow + leak checks in `tests/contract-security-boundary.test.js:153` and `tests/contract-security-boundary.test.js:192`; observability redaction contract in `tests/contract-observability.test.js:311`. |
| 6 | Reliability metrics use bounded dimensions and avoid high-cardinality labels. | ✓ VERIFIED | Allowed dimension enum and normalization in `observability/metrics.js:7` and `observability/metrics.js:62`; Redis counter key encoding only uses source/cause/routeClass/result in `observability/metrics.js:71`; server route records via bounded labels in `serverless.js:459`. |
| 7 | Operator health and metrics diagnostics are both projected through shared sanitization helpers. | ✗ FAILED | `/operator/metrics` uses projector in `serverless.js:1039`, but `/health/details` returns inline payloads in `serverless.js:1026` and `serverless.js:1029`; `projectOperatorHealth` is defined but unused (`observability/diagnostics.js:49`). |

**Score:** 6/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `observability/context.js` | AsyncLocalStorage request context + correlation extract/generate | ✓ VERIFIED | Exists (54 lines), substantive, exported API (`module.exports`), wired via `serverless.js:6` and `serverless.js:959`. |
| `observability/logger.js` | Structured logger with safe redaction + correlation bindings | ✓ VERIFIED | Exists (82 lines), redaction list in `observability/logger.js:3`, wired via `serverless.js:10` and `serverless.js:71`. |
| `observability/events.js` | Canonical telemetry taxonomy and source/cause classifier | ✓ VERIFIED | Exists (120 lines), canonical helpers in `observability/events.js:51` and `observability/events.js:105`, wired by many lifecycle emissions (`serverless.js:146`, `serverless.js:975`, `serverless.js:1117`). |
| `observability/metrics.js` | Redis-backed bounded reliability counters and aggregation | ✓ VERIFIED | Exists (174 lines), bounded dimensions + encode/decode implemented, wired via `incrementReliabilityCounter` (`serverless.js:468`) and `readReliabilitySummary` (`serverless.js:1037`). |
| `observability/diagnostics.js` | Sanitized diagnostics projection for operator health/metrics payloads | ⚠️ PARTIAL | Exists (77 lines) and substantive; `projectOperatorMetrics` is wired (`serverless.js:1039`), `projectOperatorHealth` is not wired to `/health/details`. |
| `serverless.js` | Correlated request lifecycle instrumentation + operator diagnostics routes | ✓ VERIFIED | Exists and substantive (1129 lines), request context wrapping, telemetry emission, auth-gated operator routing, and metrics recording all present. |
| `tests/contract-observability.test.js` | Correlation + taxonomy + metrics/redaction contracts | ✓ VERIFIED | Exists (323 lines), includes correlation, source taxonomy, bounded metrics, and redaction checks (`tests/contract-observability.test.js:159`, `tests/contract-observability.test.js:207`, `tests/contract-observability.test.js:272`). |
| `tests/contract-security-boundary.test.js` | Auth-boundary checks for operator diagnostics | ✓ VERIFIED | Exists (232 lines), validates unauthorized denial and authorized diagnostics (`tests/contract-security-boundary.test.js:153`, `tests/contract-security-boundary.test.js:166`). |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `serverless.js` | `observability/context.js` | Request handler wrapped with request context and correlation header | ✓ WIRED | `withRequestContext` in `serverless.js:959`; response header binding in `serverless.js:960` and `serverless.js:1099`. |
| `serverless.js` | `observability/events.js` | Canonical request/policy/dependency/degraded/completion telemetry emissions | ✓ WIRED | `emitTelemetry` uses `emitEvent` (`serverless.js:70`, `serverless.js:71`) and is invoked across lifecycle (`serverless.js:146`, `serverless.js:786`, `serverless.js:1117`). |
| `tests/contract-observability.test.js` | `serverless.js` | Handler-boundary assertions on correlation and taxonomy | ✓ WIRED | Test calls handler and asserts correlation and source fields (`tests/contract-observability.test.js:177`, `tests/contract-observability.test.js:196`, `tests/contract-observability.test.js:233`). |
| `serverless.js` | `observability/metrics.js` | Record request outcomes and read aggregated reliability summary | ✓ WIRED | Increment path at `serverless.js:1111` + `serverless.js:468`; read path for operator route at `serverless.js:1037`. |
| `serverless.js` | `observability/diagnostics.js` | Health/details and operator metrics responses projected through sanitization helpers | ⚠️ PARTIAL | `/operator/metrics` projected (`serverless.js:1039`), `/health/details` not projected (`serverless.js:1026`). |
| `tests/contract-security-boundary.test.js` | `serverless.js` | Unauthorized denied; authorized operator diagnostics allowed | ✓ WIRED | `/operator/metrics` deny/allow checks in `tests/contract-security-boundary.test.js:161` and `tests/contract-security-boundary.test.js:178`. |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
| --- | --- | --- |
| OBSV-01 | ✓ SATISFIED | None; correlation propagation across lifecycle is contract-tested. |
| OBSV-02 | ✓ SATISFIED | None; deterministic broker/redis/validation/policy classification is implemented and tested. |
| OBSV-03 | ⚠️ PARTIAL | Operator metrics are sanitized and bounded, but `/health/details` bypasses shared diagnostics projection helper. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `observability/logger.js` | 24 | `console.log(JSON.stringify(event))` fallback path | ℹ️ Info | Non-blocking fallback logger when `pino` is unavailable; still structured JSON output. |

### Gaps Summary

Phase 4 largely achieves the observability goal: correlation IDs, canonical failure taxonomy, bounded metrics, operator auth boundaries, and redaction are implemented and covered by contract tests. One must-have wiring gap remains: `/health/details` does not use the shared diagnostics projection helper (`projectOperatorHealth`), so health diagnostics are not consistently flowing through the same sanitization/projection module as `/operator/metrics`.

---

_Verified: 2026-02-22T10:42:49.439Z_
_Verifier: OpenCode (gsd-verifier)_
