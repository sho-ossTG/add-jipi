# Coding Conventions

**Analysis Date:** 2026-02-21

## Naming Patterns

**Files:**
- Use lowercase file names with no separators for top-level modules in this repo, following `addon.js` and `serverless.js`.

**Functions:**
- Use `camelCase` for function names, including helpers and handlers, as in `cleanTitle` in `addon.js` and `applyRequestControls` in `serverless.js`.

**Variables:**
- Use `UPPER_SNAKE_CASE` for module-level constants such as `B_BASE_URL` in `addon.js` and `INACTIVITY_LIMIT` in `serverless.js`.
- Use `camelCase` for local variables and parameters such as `episodeId`, `controlResult`, and `activeUrlKey` in `serverless.js`.

**Types:**
- Not applicable: the codebase is JavaScript CommonJS and does not define TypeScript types or interfaces (`package.json`, `addon.js`, `serverless.js`).

## Code Style

**Formatting:**
- Tool used: Not detected (no `.prettierrc*`, `biome.json`, or formatter config found in repo root).
- Use 2-space indentation, double quotes, trailing semicolons, and explicit object key/value formatting consistent with `addon.js` and `serverless.js`.

**Linting:**
- Tool used: Not detected (no `.eslintrc*` or `eslint.config.*` found).
- Apply existing style consistency manually when editing `addon.js` and `serverless.js`.

## Import Organization

**Order:**
1. External dependencies first, via `require(...)` (for example `stremio-addon-sdk` in `addon.js` and `serverless.js`).
2. Local module imports second (for example `require("./addon")` in `serverless.js`).
3. Local constants and function declarations after imports in the same module (`addon.js`, `serverless.js`).

**Path Aliases:**
- None detected; use relative imports only (for example `./addon` in `serverless.js`).

## Error Handling

**Patterns:**
- Validate required environment configuration early and throw `Error` with clear messages, as in `callBrokerResolve` (`addon.js`) and `redisCommand` (`serverless.js`).
- Attach machine-readable codes on infrastructure errors where needed, as done with `err.code` values in `redisCommand` in `serverless.js`.
- Wrap boundary handlers in `try/catch` and return safe fallback payloads (`{ streams: [] }` in `addon.js`, JSON/API fallback responses in `serverless.js`).
- Use targeted recovery for non-critical parsing/cache failures, with guarded `JSON.parse` blocks in `handleStreamRequest` and `handleQuarantine` in `serverless.js`.

## Logging

**Framework:** None detected (no `console.*`, logger package, or telemetry SDK usage in `addon.js` and `serverless.js`).

**Patterns:**
- Prefer structured error responses and Redis event recording over console logging, as shown by quarantine event writes in `handleStreamRequest` in `serverless.js`.

## Comments

**When to Comment:**
- Use short section comments for operational phases and invariants, matching existing comments such as `// 1. Blocked Hours` and `// Enforce HTTPS` in `serverless.js`.

**JSDoc/TSDoc:**
- Not used in current modules (`addon.js`, `serverless.js`). Keep function names and parameter names self-descriptive.

## Function Design

**Size:**
- Keep shared utility functions focused (`cleanTitle`, `formatStream`, `sendJson`) and isolate orchestration in explicit handlers (`handleStreamRequest`, exported request handler) across `addon.js` and `serverless.js`.

**Parameters:**
- Pass primitive values and request objects directly; avoid implicit globals except environment and module constants (`addon.js`, `serverless.js`).

**Return Values:**
- Return explicit JSON-serializable objects for handlers and helpers (for example `{ url, filename, title, episodeId }` in `addon.js`, `{ allowed, reason }` and stream payloads in `serverless.js`).

## Module Design

**Exports:**
- Use `module.exports` as the module boundary (`addon.js`, `serverless.js`).
- Expose additional testing/integration hook methods by attaching properties to exported interfaces when needed (`addonInterface.resolveEpisode` in `addon.js`).

**Barrel Files:**
- Not used; imports are direct per-module (`serverless.js` importing `./addon`).

---

*Convention analysis: 2026-02-21*
