---
phase: 37-http-contract-hardening
plan: 01
subsystem: api
tags: [http, cors, headers, contracts, testing]
requires: []
provides:
  - Deterministic UTF-8 JSON response contract through sendJson
  - Deterministic 204 OPTIONS preflight envelope with explicit max-age and content-length
affects: [manifest-cache-hardening, downstream-http-clients]
tech-stack:
  added: []
  patterns: [node:test header contract assertions, handler-level response contract locking]
key-files:
  created:
    - tests/contract-http-headers.test.js
    - tests/helpers/runtime-fixtures.js
  modified:
    - modules/routing/http-handler.js
key-decisions:
  - "Set JSON content type exactly to application/json; charset=utf-8 at sendJson()"
  - "Set Access-Control-Max-Age to 7200 and Content-Length to 0 for deterministic 204 preflight responses"
patterns-established:
  - "Header contracts are verified by request-level tests against createHttpHandler"
requirements-completed: [HCON-01, HCON-02]
duration: 24min
completed: 2026-03-22
---

# Phase 37 Plan 01: HTTP Header Contract Hardening Summary

**Server A now enforces explicit UTF-8 JSON and deterministic CORS preflight headers, with contract tests that lock both behaviors.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-03-22T00:00:00Z
- **Completed:** 2026-03-22T00:24:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `tests/contract-http-headers.test.js` to validate JSON content type and OPTIONS preflight header contracts.
- Added `tests/helpers/runtime-fixtures.js` to simulate local request/response execution against `createHttpHandler` deterministically.
- Updated `sendJson()` and `handlePreflight()` in `modules/routing/http-handler.js` for explicit UTF-8 JSON and deterministic preflight envelopes.

## Files Created/Modified

- `tests/contract-http-headers.test.js` - HCON-01/HCON-02 contract assertions.
- `tests/helpers/runtime-fixtures.js` - handler test harness fixtures.
- `modules/routing/http-handler.js` - JSON and preflight header contract implementation.

## Decisions Made

- Followed research-backed CORS preflight cache horizon: `Access-Control-Max-Age: 7200`.
- Applied `Content-Length: 0` on both allowed-origin and blocked-origin 204 preflight exits.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

None.

## Next Phase Readiness

- Manifest cache-header hardening (HCON-03) can be implemented on top of the new contract test file.

---
*Phase: 37-http-contract-hardening*
*Completed: 2026-03-22*
