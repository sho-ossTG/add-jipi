---
phase: 06-milestone-audit-cleanup
plan: 03
subsystem: docs
tags: [modules, boundaries, maintainability, cleanup]

# Dependency graph
requires:
  - phase: 06-01
    provides: Manual outage verification matrix and acceptance criteria
  - phase: 06-02
    provides: Stremio verification runbook with command-first evidence flow
provides:
  - Explicit maintainer-only role for `modules/index.js`
  - Boundary guidance that forbids runtime imports through the module map
  - Closed audit debt item for informational-surface ambiguity
affects: [phase-closeout, maintenance, code-review]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Manifest files should be declarative and non-runtime
    - Runtime paths import concrete boundary modules directly

key-files:
  created:
    - .planning/phases/06-milestone-audit-cleanup/06-03-SUMMARY.md
  modified:
    - modules/index.js
    - modules/BOUNDARIES.md

key-decisions:
  - "Resolve `modules/index.js` debt via explicit de-scope: maintainers-only manifest, not runtime import surface."
  - "Convert manifest entries from eager requires to path strings to remove accidental runtime coupling."

patterns-established:
  - "Declarative module map: keep `modules/index.js` as ownership/discoverability metadata only."
  - "Direct runtime imports: entrypoints and handlers import boundary files directly, not the manifest."

# Metrics
duration: 2 min
completed: 2026-02-22
---

# Phase 6 Plan 3: modules/index.js Debt Resolution Summary

**`modules/index.js` is now an explicit maintainer-only manifest with direct-import runtime guidance documented in boundary rules.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-22T16:40:55Z
- **Completed:** 2026-02-22T16:42:54Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Resolved the ambiguous role of `modules/index.js` with a low-risk explicit decision.
- Replaced eager `require(...)` exports in `modules/index.js` with declarative module path entries.
- Added concrete boundary guidance describing when `modules/index.js` should and should not be used.

## Task Commits

Each task was committed atomically:

1. **Task 1: Decide and implement modules/index.js cleanup path** - `5813d8b` (chore)

## Files Created/Modified
- `modules/index.js` - Converted to frozen maintainer-manifest with explicit runtime import rule.
- `modules/BOUNDARIES.md` - Added `modules/index.js` role section and maintenance guidance.

## Decisions Made
- Chose path B (intentional informational surface) to avoid architecture expansion and runtime-risky rewiring.
- Enforced the decision in both code and boundaries docs so maintainers have one non-contradictory guidance source.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 06 cleanup scope is complete for this plan's debt item.
- No blockers; guidance is explicit and maintainable.

---
*Phase: 06-milestone-audit-cleanup*
*Completed: 2026-02-22*
