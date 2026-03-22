---
phase: 37-http-contract-hardening
plan: 02
subsystem: api
tags: [manifest, cache-control, headers, contracts, evidence]
requires:
  - phase: 37-http-contract-hardening
    provides: HCON-01 and HCON-02 test harness and contract baseline
provides:
  - Explicit manifest cache policy interception before runtimeRouter
  - Requirement-to-code-to-test evidence mapping for HCON-01/HCON-02/HCON-03
affects: [stremio-manifest-consumers, cold-start-load]
tech-stack:
  added: []
  patterns: [pre-dispatch response header interception for route-specific contracts]
key-files:
  created:
    - .planning/phases/37-http-contract-hardening/37-CONTRACT-EVIDENCE.md
  modified:
    - modules/routing/http-handler.js
    - tests/contract-http-headers.test.js
key-decisions:
  - "Set manifest cache policy to public, max-age=300, must-revalidate"
  - "Keep non-manifest stremio routes free from manifest-specific cache override"
patterns-established:
  - "Manifest contract headers are injected before stremio runtimeRouter dispatch"
requirements-completed: [HCON-03]
duration: 16min
completed: 2026-03-22
---

# Phase 37 Plan 02: Manifest Cache Contract Summary

**Server A now sets a bounded, explicit cache policy for `/manifest.json` and includes phase-local requirement evidence for all HTTP hardening contracts.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-03-22T00:24:00Z
- **Completed:** 2026-03-22T00:40:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Extended `tests/contract-http-headers.test.js` with manifest cache policy assertions and non-manifest regression coverage.
- Updated `createHttpHandler()` in `modules/routing/http-handler.js` to set `Cache-Control: public, max-age=300, must-revalidate` for `pathname === "/manifest.json"` before `runtimeRouter` dispatch.
- Added `.planning/phases/37-http-contract-hardening/37-CONTRACT-EVIDENCE.md` mapping HCON-01/02/03 to implementation points and verification commands.

## Files Created/Modified

- `modules/routing/http-handler.js` - manifest cache-control interception.
- `tests/contract-http-headers.test.js` - HCON-03 contract coverage and non-manifest guard.
- `.planning/phases/37-http-contract-hardening/37-CONTRACT-EVIDENCE.md` - requirement evidence mapping.

## Decisions Made

- Implemented cache policy in runtime handler path (not `vercel.json`) to keep behavior local and testable.
- Limited cache policy scope to `/manifest.json` only.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

None.

## Next Phase Readiness

- HTTP header contracts for HCON-01/HCON-02/HCON-03 are now implementation-locked by tests and documented evidence.

---
*Phase: 37-http-contract-hardening*
*Completed: 2026-03-22*
