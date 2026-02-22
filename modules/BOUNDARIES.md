# Modules Boundary Map

This directory defines ownership for the Phase 5 modular migration. The goal is to separate concerns first, then rewire runtime entrypoints in later plans.

## Module boundaries

- `modules/routing/`: HTTP route composition and request flow orchestration.
- `modules/policy/`: business policy decisions and deterministic rule evaluation.
- `modules/integrations/`: external dependency clients (Redis, broker, other services).
- `modules/presentation/`: response shaping and payload formatting.

Hybrid model:
- Keep shared, cross-cutting helpers where they already exist.
- Add concern-owned modules under `modules/` for policy and integrations first.
- Rewiring is incremental; this document is guardrail documentation, not lint enforcement.

Ownership examples:
- Policy example: `modules/policy/time-window.js` owns Jerusalem shutdown-window decisions.
- Integration example: `modules/integrations/redis-client.js` owns Redis command/eval transport.

## Allowed imports

Primary direction:
- `routing` -> `policy`, `integrations`, `presentation`
- `policy` -> shared pure utilities only (no direct service clients)
- `integrations` -> shared transport/runtime utilities only
- `presentation` -> policy output types and shared formatting utilities

Within the same module boundary:
- Files may import other files from the same boundary (for example `policy/*` -> `policy/*`).

Entrypoint compatibility during migration:
- `serverless.js` and `addon.js` may continue importing legacy helpers until rewiring plans land.

## Forbidden imports

Hard no-mix constraints for this phase:
- `integrations` must not import `presentation`.
- `policy` must not call external services directly.
- `routes` should not contain reusable business logic.

Additional forbidden directions:
- `presentation` must not import service clients from `integrations`.
- `integrations` must not import route handlers from `routing`.
- `policy` must not import route handlers from `routing`.

These constraints are enforced by code review and plan verification in this phase; static lint enforcement is intentionally deferred.
