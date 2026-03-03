# AGENTS.md

**Every time you receive any instruction, check this table first.**
If the instruction matches a `/gsd:` command, read the command file before doing anything else — before reading other files, before writing code, before planning.

The command file is your entry point. It tells you exactly which workflow to run, which agents to spawn, what files to read, and in what order. Do not improvise. Do not skip this step.

All command files are in: `.opencode/commands/gsd/`

| Command | File |
|---------|------|
| `/gsd-discuss-phase`          | `.opencode/commands/gsd/gsd-discuss-phase.md` |
| `/gsd-plan-phase`             | `.opencode/commands/gsd/gsd-plan-phase.md` |
| `/gsd-execute-phase`          | `.opencode/commands/gsd/gsd-execute-phase.md` |
| `/gsd-verify-work`            | `.opencode/commands/gsd/gsd-verify-work.md` |
| `/gsd-progress`               | `.opencode/commands/gsd/gsd-progress.md` |
| `/gsd-resume-work`            | `.opencode/commands/gsd/gsd-resume-work.md` |
| `/gsd-pause-work`             | `.opencode/commands/gsd/gsd-pause-work.md` |
| `/gsd-debug`                  | `.opencode/commands/gsd/gsd-debug.md` |
| `/gsd-map-codebase`           | `.opencode/commands/gsd/gsd-map-codebase.md` |
| `/gsd-quick`                  | `.opencode/commands/gsd/gsd-quick.md` |
| `/gsd-new-project`            | `.opencode/commands/gsd/gsd-new-project.md` |
| `/gsd-new-milestone`          | `.opencode/commands/gsd/gsd-new-milestone.md` |
| `/gsd-add-phase`              | `.opencode/commands/gsd/gsd-add-phase.md` |
| `/gsd-insert-phase`           | `.opencode/commands/gsd/gsd-insert-phase.md` |
| `/gsd-remove-phase`           | `.opencode/commands/gsd/gsd-remove-phase.md` |
| `/gsd-add-todo`               | `.opencode/commands/gsd/gsd-add-todo.md` |
| `/gsd-check-todos`            | `.opencode/commands/gsd/gsd-check-todos.md` |
| `/gsd-audit-milestone`        | `.opencode/commands/gsd/gsd-audit-milestone.md` |
| `/gsd-complete-milestone`     | `.opencode/commands/gsd/gsd-complete-milestone.md` |
| `/gsd-cleanup`                | `.opencode/commands/gsd/gsd-cleanup.md` |
| `/gsd-health`                 | `.opencode/commands/gsd/gsd-health.md` |
| `/gsd-help`                   | `.opencode/commands/gsd/gsd-help.md` |
| `/gsd-settings`               | `.opencode/commands/gsd/gsd-settings.md` |
| `/gsd-set-profile`            | `.opencode/commands/gsd/gsd-set-profile.md` |
| `/gsd-update`                 | `.opencode/commands/gsd/gsd-update.md` |
| `/gsd-list-phase-assumptions` | `.opencode/commands/gsd/gsd-list-phase-assumptions.md` |
| `/gsd-plan-milestone-gaps`    | `.opencode/commands/gsd/gsd-plan-milestone-gaps.md` |
| `/gsd-research-phase`         | `.opencode/commands/gsd/gsd-research-phase.md` |
| `/gsd-reapply-patches`        | `.opencode/commands/gsd/gsd-reapply-patches.md` |

---

Practical guidance for coding agents working in `add-jipi`.

## Project Snapshot

- Runtime: Node.js CommonJS addon/service for Stremio.
- Entry point: `serverless.js` delegates to `modules/routing/http-handler.js`.
- Protocol surfaces: `/manifest.json`, `/catalog/...`, `/stream/...` plus operator/public routes.
- Core migration context: Server A -> D integration (`modules/integrations/d-client.js`).

## Source of Truth Docs

- Read `CLAUDE.md` for architecture, env vars, and deployment context.
- Read `modules/BOUNDARIES.md` before moving logic across module boundaries.
- Read `TEST-GATES.md` before changing test scripts or release-gate expectations.

## Cursor/Copilot Rules Status

- `.cursor/rules/`: not present in this repository.
- `.cursorrules`: not present in this repository.
- `.github/copilot-instructions.md`: not present in this repository.
- Therefore, follow repository code and this file as the operational policy.

## Install and Run

- Install deps: `npm install`
- Start local serverless handler: `npm start`
- The app expects Redis env vars for most request flows.

## Build / Lint / Test Commands

## Build

- There is no dedicated build step configured in `package.json`.
- Deploy target is Vercel serverless (`vercel.json`), so keep runtime code Node-compatible.

## Lint / Format

- There is no ESLint/Prettier script configured.
- Keep formatting consistent with existing files (2 spaces, semicolons, double quotes).
- Prefer minimal diffs; do not reformat unrelated files.

## Test (single test first)

- Run one file directly (preferred during iteration):
  - `node --test tests/<filename>.test.js`
- Example:
  - `node --test tests/contract-stream.test.js`

## Test scripts (npm)

- `npm run test:analytics:hourly`
- `npm run test:analytics:nightly-rollup`
- `npm run test:session:view-ttl`
- `npm run test:request-controls:nightly`
- `npm run test:policy:time-window`
- `npm run test:policy:session-gate`
- `npm run test:policy:deterministic`
- `npm run test:contract:observability`
- `npm run test:contract:reliability`
- `npm run test:contract:manifest-catalog`
- `npm run test:contract:stream`
- `npm run test:contract:stream:failures`
- `npm run test:contract:security`
- `npm run test:contract:log-shipping`
- `npm run test:contract:cors`

## Release gates

- Required before deploy: `npm run test:gate:required`
- Optional diagnostics: `npm run test:gate:optional`
- Full validation: `npm run test:gate:all`

## Code Organization Rules

- Respect module boundaries:
  - `routing` orchestrates request flow.
  - `policy` contains deterministic business rules.
  - `integrations` contains external service/transport clients.
  - `presentation` shapes HTTP and addon payloads.
- Import direction (required):
  - `routing -> policy|integrations|presentation`
  - `policy` must not call service clients directly.
  - `integrations` must not import routing/presentation.
- Do not import `modules/index.js` at runtime; it is a maintainer manifest.

## JavaScript Style Conventions

- Module system: CommonJS only (`require`, `module.exports`).
- Indentation: 2 spaces.
- Strings: double quotes.
- Semicolons: required.
- Trailing commas: generally avoided; follow local file style.
- Prefer small pure helpers for parsing/normalization logic.
- Use `Object.freeze(...)` for constant maps/policies that should be immutable.

## Imports and Exports

- Group imports in this order:
  1. Node/built-in or external packages
  2. Internal modules (relative paths)
- Keep import paths explicit; avoid barrel indirection for runtime code.
- Export explicit named functions/objects via `module.exports = { ... }`.

## Naming Conventions

- `camelCase` for variables/functions.
- `UPPER_SNAKE_CASE` for constants and default timeout/TTL values.
- Use descriptive function names (`parsePositiveIntEnv`, `handleStreamRequest`).
- Error/decision reasons use stable machine-readable strings:
  - Examples: `dependency_timeout`, `dependency_unavailable`, `validation_error`, `blocked:slot_taken`.

## Types and Data Validation (JS project)

- No TypeScript here; enforce contracts with runtime validation.
- Normalize external input immediately (`String(...)`, `Number(...)`, trims).
- Validate integration payloads before use (see `d-client` response checks).
- Prefer returning shaped objects with predictable keys for downstream callers.

## Error Handling Patterns

- Attach structured metadata to errors:
  - `error.code` (required for classification)
  - `error.statusCode` (when available)
- Preserve `dependency_timeout` semantics; do not remap it accidentally.
- Use best-effort `catch` blocks for non-critical telemetry/analytics writes.
- Never let analytics/log shipping failures break stream/public responses.
- For user-visible fallbacks, return protocol-safe payloads (often empty streams).

## Observability and Logging

- Use `observability/logger.js` (`getLogger`) instead of raw console logging in runtime paths.
- Emit structured events via `emitEvent` and `EVENTS` constants.
- Ensure correlation IDs propagate via request context helpers.
- Do not log secrets/tokens; rely on logger redaction paths.

## Testing Guidelines

- Test framework: Node built-in `node:test` + `node:assert/strict`.
- Prefer deterministic fixtures from `tests/helpers/runtime-fixtures.js`.
- When patching globals (for example `global.fetch`), always restore in `finally`.
- When patching env vars, restore original values in `finally`.
- Clear `require.cache` when tests depend on module initialization side effects.
- Cover both success and degraded/failure behavior for contract-sensitive paths.

## Environment and Integration Notes

- Redis config supported via:
  - `KV_REST_API_URL` / `KV_REST_API_TOKEN`
  - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
- D integration configured by `D_BASE_URL` (+ optional timeout env vars).
- Session/policy controls rely on `MAX_SESSIONS`, `SLOT_TTL_SEC`, `RECONNECT_GRACE_MS`.

## Agent Workflow Recommendations

- Before editing, inspect nearby code for conventions and boundary constraints.
- Prefer targeted changes over broad refactors.
- Run a single relevant test file first, then the smallest applicable gate.
- For deploy-sensitive changes, run `npm run test:gate:required` before handing off.
- If behavior changes cross routing/policy/integration seams, add or update contract tests.
