# Requirements: add-jipi

**Defined:** 2026-02-21
**Core Value:** Users can reliably request a supported episode and immediately receive a valid playable stream.

## v1 Requirements

Requirements for initial release hardening. Each maps to roadmap phases.

### Contract Compatibility

- [x] **CONT-01**: User can install the addon and receive a valid `manifest.json` response compatible with Stremio clients.
- [x] **CONT-02**: User can browse catalog entries and receive valid catalog payloads for supported content.
- [x] **CONT-03**: User requesting a supported episode receives a protocol-valid stream response.

### Security

- [x] **SECU-01**: Operator can access diagnostics routes only after authenticated and authorized admin checks.
- [x] **SECU-02**: User requests are attributed to trusted client identity, not spoofable forwarded headers.
- [x] **SECU-03**: Sensitive diagnostics data is redacted so public routes never expose raw IPs or internal error details.
- [x] **SECU-04**: Browser clients only receive CORS permissions for explicitly allowed origins and headers.

### Reliability

- [x] **RELY-01**: User stream requests enforce capacity/session policy with atomic Redis-backed gating under concurrency.
- [x] **RELY-02**: User stream resolution uses bounded dependency calls (timeouts and retry limits) to avoid hung requests.
- [x] **RELY-03**: User receives deterministic fallback behavior when broker or Redis dependencies fail.

### Observability

- [ ] **OBSV-01**: Operator can trace failed or degraded requests using correlation IDs across request, policy, and dependency calls.
- [ ] **OBSV-02**: Operator can see structured failure categories that distinguish broker, Redis, validation, and policy failures.
- [ ] **OBSV-03**: Operator can query health and key reliability metrics without exposing sensitive internals.

### Maintainability & Quality

- [ ] **MAINT-01**: Maintainer can modify routing, policy, integration, and presentation code in separate modules with clear boundaries.
- [ ] **MAINT-02**: Maintainer can run automated tests covering stream contract behavior and failure branches before deployment.
- [ ] **MAINT-03**: Maintainer can reproduce core policy time-window and session-gating behavior with deterministic tests.

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Operational Maturity

- **OPER-01**: Operator receives proactive alerting dashboards with SLO-based thresholds.
- **OPER-02**: Operator can run policy dry-run simulations for capacity rules without affecting live traffic.

### Product Expansion

- **PROD-01**: User can stream additional content domains beyond current supported title pattern.
- **PROD-02**: Tenant admins can manage multi-tenant policies and billing controls.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Public unauthenticated diagnostics dashboard | Security and privacy risk; conflicts with production hardening goals |
| Native mobile app client | Project scope is backend addon service, not client application development |
| Unbounded dependency retries | Increases outage blast radius and latency under failure conditions |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONT-01 | Phase 1 | Complete |
| CONT-02 | Phase 1 | Complete |
| CONT-03 | Phase 1 | Complete |
| SECU-01 | Phase 2 | Complete |
| SECU-02 | Phase 2 | Complete |
| SECU-03 | Phase 2 | Complete |
| SECU-04 | Phase 2 | Complete |
| RELY-01 | Phase 3 | Complete |
| RELY-02 | Phase 3 | Complete |
| RELY-03 | Phase 3 | Complete |
| OBSV-01 | Phase 4 | Pending |
| OBSV-02 | Phase 4 | Pending |
| OBSV-03 | Phase 4 | Pending |
| MAINT-01 | Phase 5 | Pending |
| MAINT-02 | Phase 5 | Pending |
| MAINT-03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0

---
*Requirements defined: 2026-02-21*
*Last updated: 2026-02-21 after roadmap mapping*
