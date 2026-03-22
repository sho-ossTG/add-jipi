---
phase: 37
slug: http-contract-hardening
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-22
---

# Phase 37 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (Node.js built-in) |
| **Config file** | none |
| **Quick run command** | `node --test tests/contract-http-headers.test.js` |
| **Full suite command** | `npm run test:gate:required` |
| **Estimated runtime** | ~30-45 seconds (quick), ~120 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run `node --test tests/contract-http-headers.test.js`
- **After every plan wave:** Run `npm run test:gate:required`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds for quick loop

---

## Per-task Verification Map

| task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 37-01-01 | 01 | 1 | HCON-01 | contract | `node --test tests/contract-http-headers.test.js` | ❌ W0 | ⬜ pending |
| 37-01-02 | 01 | 1 | HCON-02 | contract | `node --test tests/contract-http-headers.test.js` | ❌ W0 | ⬜ pending |
| 37-02-01 | 02 | 2 | HCON-03 | contract | `node --test tests/contract-http-headers.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending - ✅ green - ❌ red - ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/contract-http-headers.test.js` - header contract tests for HCON-01/02/03
- [ ] `tests/helpers/runtime-fixtures.js` - request/response simulation helpers (if missing)

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s (quick loop)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
