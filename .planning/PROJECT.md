# add-jipi

## What This Is

add-jipi is a Stremio addon service that resolves episode requests into playable stream URLs through a broker backend. It is deployed as a Node.js serverless entrypoint and includes operational endpoints for health and quarantine telemetry. The project currently focuses on making the addon reliable, secure, and maintainable for production use.

## Core Value

Users can reliably request a supported episode and immediately receive a valid playable stream.

## Requirements

### Validated

- ✓ Expose Stremio manifest and catalog endpoints for addon clients — existing
- ✓ Resolve supported stream episode IDs through broker integration — existing
- ✓ Enforce basic slot/session controls with Redis-backed state — existing
- ✓ Provide operational health and quarantine endpoints for diagnostics — existing

### Active

- [ ] Harden request handling and admin endpoints to meet baseline production security.
- [ ] Improve stream-path resiliency and observability so failures are diagnosable.
- [ ] Reduce architecture coupling by separating routing, policy, integrations, and presentation concerns.

### Out of Scope

- Native mobile app clients — this project is a server-side addon backend.
- Multi-tenant account and billing system — no product requirement for tenant management today.
- New content domain expansion beyond current supported title pattern — preserve focused scope while stabilizing core path.

## Context

The codebase is a compact JavaScript/CommonJS serverless addon built on `stremio-addon-sdk`, with Redis REST integration for control-state and metrics, and broker API integration for stream URL resolution. A codebase map already exists under `.planning/codebase/` and identifies major concerns around monolithic structure, weak observability, limited test coverage, and exposed operational surfaces. This initialization uses that baseline to define execution-ready planning artifacts.

## Constraints

- **Tech stack**: Keep Node.js CommonJS and Stremio addon contract compatibility — avoids unnecessary migration risk during stabilization.
- **Deployment**: Must run in Vercel-style serverless runtime — current production routing and env model depend on it.
- **Dependency boundary**: Keep broker API + Redis REST as external dependencies — core behavior requires both integrations.
- **Reliability**: Preserve valid fallback behavior for stream responses — addon clients must always receive protocol-safe output.
- **Security**: Avoid exposing sensitive operational data publicly — current admin diagnostics are too open.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Initialize as an auto-driven brownfield planning cycle | Existing code and codebase map already define current system behavior | — Pending |
| Keep architecture evolution incremental instead of rewrite | Minimize disruption to active stream delivery path | — Pending |
| Prioritize hardening and observability before feature expansion | Stability and diagnosability are required foundations for safe iteration | — Pending |

---
*Last updated: 2026-02-21 after initialization*
