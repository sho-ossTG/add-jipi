# Test Gate Governance

This project uses deployment test gates to separate must-pass release safety checks from broader diagnostics.

## Gate Tiers

### Required gate (must pass before deployment)

- Command: `npm run test:gate:required`
- Scope:
  - `tests/contract-stream.test.js`
  - `tests/contract-stream-reliability.test.js`
  - `tests/contract-stream-failures.test.js`
  - `tests/policy-time-window.test.js`
  - `tests/policy-session-gate.test.js`
- Purpose: lock stream contract behavior, failure fallback mapping, and deterministic policy boundaries before deploy.

### Optional diagnostics gate

- Command: `npm run test:gate:optional`
- Scope:
  - `npm run test:contract:manifest-catalog`
  - `npm run test:contract:security`
  - `npm run test:contract:cors`
  - `npm run test:contract:observability`
- Purpose: run broader protocol and operator-safety diagnostics when preparing larger releases or incident follow-ups.

### Full validation gate

- Command: `npm run test:gate:all`
- Purpose: run required and optional gates in one command.

## Script Map

| Tier | Script | Requirement |
| --- | --- | --- |
| Required | `test:gate:required` | Must pass before deployment |
| Optional | `test:gate:optional` | Recommended for broader diagnostics |
| Optional | `test:gate:all` | Recommended before major rollout |

## Policy

- Deployment readiness requires a passing `test:gate:required` run.
- Optional gates add confidence but do not block routine deployment.
