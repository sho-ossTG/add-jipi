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
- Routing example: `modules/routing/http-handler.js` composes request flow and delegates route branches to boundary modules.
- Presentation examples:
  - `modules/presentation/public-pages.js` owns landing and public health response rendering.
  - `modules/presentation/operator-diagnostics.js` owns operator diagnostics projection boundaries.
  - `modules/presentation/quarantine-page.js` owns sanitized quarantine HTML rendering.

## Allowed imports

Primary direction:
- `routing` -> `policy`, `integrations`, `presentation`
- `policy` -> shared pure utilities only (no direct service clients)
- `integrations` -> shared transport/runtime utilities only
- `presentation` -> policy output types and shared formatting utilities

Within the same module boundary:
- Files may import other files from the same boundary (for example `policy/*` -> `policy/*`).

Entrypoint compatibility during migration:
- `serverless.js` is a thin adapter that imports `createHttpHandler` from `modules/routing/http-handler.js`.
- `addon.js` remains the stream resolver integration surface and is consumed by routing/integration boundaries.

## Post-migration file-level import examples

Final import-direction examples after 05-05 migration:

- `serverless.js` -> `modules/routing/http-handler.js`
- `modules/routing/http-handler.js` -> `modules/routing/operator-routes.js`
- `modules/routing/http-handler.js` -> `modules/presentation/public-pages.js`
- `modules/routing/operator-routes.js` -> `modules/presentation/operator-diagnostics.js`
- `modules/routing/operator-routes.js` -> `modules/presentation/quarantine-page.js`
- `modules/routing/http-handler.js` -> `modules/routing/request-controls.js` and `modules/routing/stream-route.js`
- `modules/routing/stream-route.js` -> `modules/integrations/broker-client.js` and `modules/presentation/stream-payloads.js`

These examples are intentionally concrete so maintainers can change route behavior or output shaping without editing integration clients.

## Forbidden imports

Hard no-mix constraints for this phase:
- `integrations` must not import `presentation`.
- `policy` must not call external services directly.
- `routes` should not contain reusable business logic.

Additional forbidden directions:
- `presentation` must not import service clients from `integrations`.
- `integrations` must not import route handlers from `routing`.
- `policy` must not import route handlers from `routing`.

These constraints are documented and enforced by code review plus contract verification in this phase.
Static import-direction lint automation is intentionally deferred to a future phase.
