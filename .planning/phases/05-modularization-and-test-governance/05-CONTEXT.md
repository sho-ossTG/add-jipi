# Phase 5: Modularization and Test Governance - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 restructures the backend into maintainable module boundaries and defines deterministic validation governance so maintainers can safely evolve routing, policy, integrations, and response presentation without regressions.

This phase clarifies organization and validation rules inside existing capabilities; it does not add new product features.

</domain>

<decisions>
## Implementation Decisions

### Module boundary map
- Use a hybrid boundary model: keep global shared layers while allowing feature-local modules when shared abstraction would be premature.
- Cross-cutting concerns use mixed placement: true shared core helpers plus small layer-local helpers where appropriate.
- Policy logic is split by concern (capacity, session, eligibility) and composed by routes.
- Response shaping can remain in current style where needed, with gradual migration toward presentation modules.
- Hard no-mix rules are required:
  - integrations must not import presentation,
  - policy must not call external services directly,
  - routes should not contain reusable business logic.
- Import-direction rules should be documented in this phase and enforced in a later phase.
- Migration strategy is two-step: scaffold module structure first, then migrate critical paths in targeted batches.

### File and naming conventions
- Keep existing naming style in current areas; standardize only new module roots introduced in this phase.
- Use a thin top-level `modules/` directory to group modular concerns.

### Test gate policy before deployment
- Planning-only default: define mandatory gate tiers (required vs optional) in this phase and align them to existing contract suites.
- Exact command-level enforcement policy is left to OpenCode discretion during planning because execution/testing is intentionally paused on this machine.

### Failure-branch coverage expectations
- Planning-only default: prioritize deterministic coverage for degraded/failure branches that affect policy decisions, dependency handling, and protocol-safe responses.
- Exact branch matrix and strictness thresholds are left to OpenCode discretion during planning.

### OpenCode's Discretion
- Final shape of `modules/` subtrees and exact file map.
- Documentation format for import-direction constraints.
- Specific required-vs-optional test gate matrix and branch coverage matrix details.

</decisions>

<specifics>
## Specific Ideas

- Keep refactoring incremental and low-risk: scaffold first, then migrate in focused batches.
- Treat boundary rules as design constraints immediately, while hard enforcement can come after adoption stabilizes.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

*Phase: 05-modularization-and-test-governance*
*Context gathered: 2026-02-22*
