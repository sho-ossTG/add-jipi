# Roadmap — Server A (add-jipi)

## Milestones

- ✅ **v1.0 Server A → D Integration** — Phases 0–5 (shipped 2026-03-03)
- 📋 **v2.0** — Planned (gap closure + next features)

---

## Phases

<details>
<summary>✅ v1.0 Server A → D Integration (Phases 0–5) — SHIPPED 2026-03-03</summary>

- [x] Phase 0: Prerequisites (3/3 plans) — completed 2026-03-02
- [x] Phase 1: D Client Interface + Stub (1/1 plans) — completed 2026-03-02
- [x] Phase 2: Wire Resolution Path (2/2 plans) — completed 2026-03-02
- [x] Phase 3: User-Agent Forwarding (2/2 plans) — completed 2026-03-02
- [x] Phase 4: Nightly Log Shipping (2/2 plans) — completed 2026-03-02
- [x] Phase 5: Broker Deprecation (2/2 plans) — completed 2026-03-02

Full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

---

### 📋 v2.0 (Planned)

Carry-forward from v1.0 (all deferred by decision 2026-03-03):

- [ ] Phase 6: `executeBoundedDependency` sole-definition cleanup — remove local wrapper in `redis-client.js` and inlined copy in `http-handler.js` (PRE-3)
- [ ] Phase 7: FR-5 nightly log shipping push — wire `shipFailureLogs` into rollup route and `runNightlyMaintenance` path with sequencing + failure-isolation tests
- [ ] Phase 8: FR-3 metrics cleanup — remove broker-source fallback normalization branch from `observability/metrics.js:58` and lock with contract coverage

---

## Progress

| Phase | Milestone | Plans Complete | Status   | Completed  |
|-------|-----------|----------------|----------|------------|
| 0. Prerequisites | v1.0 | 3/3 | Complete | 2026-03-02 |
| 1. D Client Interface + Stub | v1.0 | 1/1 | Complete | 2026-03-02 |
| 2. Wire Resolution Path | v1.0 | 2/2 | Complete | 2026-03-02 |
| 3. User-Agent Forwarding | v1.0 | 2/2 | Complete | 2026-03-02 |
| 4. Nightly Log Shipping | v1.0 | 2/2 | Complete | 2026-03-02 |
| 5. Broker Deprecation | v1.0 | 2/2 | Complete | 2026-03-02 |
| 6. Bounded-dep sole definition | v2.0 | 0/1 | Not started | — |
| 7. FR-5 nightly shipping push | v2.0 | 0/2 | Not started | — |
| 8. FR-3 metrics broker cleanup | v2.0 | 0/1 | Not started | — |
