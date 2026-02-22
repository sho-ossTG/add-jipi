# add-jipi

## What This Is

add-jipi is a Stremio addon backend that resolves supported episode requests into playable stream URLs with deterministic contract behavior, secure operational boundaries, reliability controls, and operator-safe diagnostics.

## Core Value

Users can reliably request a supported episode and immediately receive a valid playable stream.

## Current State

- Shipped milestone: v1.0 MVP Hardening (2026-02-22)
- Delivery status: 6 phases complete, 18 plans complete, 16 of 16 v1 requirements shipped
- Validation status: milestone audit showed full requirements/phase/integration coverage with only low-severity manual environment checks deferred
- Integration/network verification status: deferred for protected/authenticated endpoints and live dependency checks; execute documented runbooks on a network-enabled tester machine

## Next Milestone Goals

- Execute deferred live-environment verification runbooks and attach evidence artifacts.
- Define v1.1 requirements and roadmap scope from operational feedback.
- Prioritize operational maturity requirements (`OPER-01`, `OPER-02`) versus product expansion (`PROD-01`, `PROD-02`).

## Requirements

### Validated

- v1.0 requirements archive: `.planning/milestones/v1.0-REQUIREMENTS.md`

### Active

- [ ] Create new milestone requirements document via `/gsd-new-milestone`.
- [ ] Decide v1.1 focus area (operational maturity, product expansion, or mixed scope).

### Out of Scope

- Native mobile app clients - this project remains a server-side addon backend.
- Multi-tenant account and billing system - no active requirement for tenant management.

## Context

The current codebase is a modularized JavaScript/CommonJS serverless addon using `stremio-addon-sdk`, Redis REST integrations, and broker API resolution with deterministic policy and contract tests. Milestone v1.0 established stable runtime boundaries and governance, while live-network validation remains intentionally documented as manual runbooks due offline execution constraints on this machine.

## Constraints

- **Tech stack**: Keep Node.js CommonJS and Stremio addon contract compatibility.
- **Deployment**: Must run in Vercel-style serverless runtime.
- **Dependency boundary**: Keep broker API + Redis REST as external dependencies.
- **Reliability**: Preserve protocol-safe fallback behavior for stream responses.
- **Security**: Keep operational diagnostics auth-gated and sanitized.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep architecture evolution incremental instead of rewrite | Minimize disruption to active stream delivery path | Good |
| Prioritize hardening and observability before feature expansion | Stability and diagnosability are required before broader scope | Good |
| Adopt modular routing/policy/integration/presentation boundaries | Reduce coupling and improve maintainer safety | Good |
| Keep live-network checks as explicit manual runbooks under offline constraints | Preserve operational verification quality without violating local execution limits | Good |

---
*Last updated: 2026-02-22 after v1.0 milestone completion*
