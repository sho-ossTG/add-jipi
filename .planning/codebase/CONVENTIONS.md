# Coding Conventions

**Analysis Date:** 2026-02-25

## Naming Patterns

**Files:**
- `kebab-case.js` for all module files under `modules/` and `observability/` (e.g., `broker-client.js`, `session-gate.js`, `hourly-tracker.js`).
- Lowercase root-level files with role-oriented names: `addon.js`, `serverless.js`.

**Functions:**
- `camelCase` throughout.
- Factory functions: `create` prefix (e.g., `createRedisClient`, `createBrokerClient`, `createHttpHandler`).
- Boolean predicates: `is` prefix (e.g., `isStremioRoute`, `isWithinShutdownWindow`, `isCurrentEpisodeSelection`, `isTransientDependencyFailure`).
- Route handlers: `handle` prefix (e.g., `handleStreamRequest`, `handleOperatorRoute`, `handlePreflight`).
- Projectors: `project` prefix (e.g., `projectPublicHealth`).
- Renderers: `render` prefix (e.g., `renderLandingPage`, `renderQuarantinePage`).

**Variables:**
- `UPPER_SNAKE_CASE` for module-level constants (e.g., `EPISODE_SHARE_TTL_SEC`, `MAX_SESSIONS`, `DEFAULT_TRUST_PROXY`, `SESSION_GATE_SCRIPT`).
- `camelCase` for local variables and parameters (e.g., `episodeId`, `controlResult`, `shareKey`).

**Types:**
- Not applicable: CommonJS JavaScript, no TypeScript interfaces or JSDoc type annotations.

## Code Style

**Formatting:**
- 2-space indentation, double quotes, trailing semicolons.
- No formatter config detected (no `.prettierrc*`, `biome.json`, or `eslint.config.*`). Style enforced by code review.

**Linting:**
- No linting tooling detected. Consistency maintained manually.

## Import Organization

**Order:**
1. External npm dependencies (e.g., `stremio-addon-sdk`, `proxy-addr`, `pino`).
2. `observability/` imports.
3. Local `modules/` imports, grouped by boundary layer.

**Path Aliases:**
- None; relative paths only (e.g., `../../observability/events`, `../integrations/redis-client`).

**Module Manifest:**
- `modules/index.js` is a maintainer-facing manifest listing module entrypoints. It is **never imported at runtime**. Runtime code imports concrete files directly (e.g., `modules/routing/http-handler.js`).

## Dependency Injection (DI) Pattern

All significant functions use the signature `(input = {}, injected = {})`:

```js
async function handleStreamRequest(input = {}, injected = {}) {
  const formatStream = injected.formatStream || defaultStreamPayloads.formatStream;
  const sendDegradedStream = injected.sendDegradedStream || streamPayloads.sendDegradedStream;
  // ...
}
```

- `input` — the data payload for this invocation (request, pathname, IP, etc.).
- `injected` — overridable dependencies; resolve to production defaults when not provided.
- This pattern enables full test injection without module mocking.

## Handler Return Shape

All route handlers return a consistent `{ handled, outcome }` shape:

```js
// Route matched and handled:
return {
  handled: true,
  outcome: { source: "broker", cause: "success", result: "success" }
};

// Route not matched (fall through):
return { handled: false };
```

`outcome.result` is one of: `"success"`, `"degraded"`, `"failure"`.

## Error Handling

**Infrastructure errors:**
- Attach `.code` (machine-readable string) and `.statusCode` (HTTP integer) before throwing.
```js
const err = new Error("Broker request failed");
err.code = "broker_http_error";
err.statusCode = response.status;
throw err;
```

**Transient vs. fatal:**
- `isTransientDependencyFailure(error)` classifies retryable errors (408, 429, 5xx, ETIMEDOUT, ECONNRESET, ECANCELED, AbortError).
- `executeBoundedDependency` handles one retry within a total budget.

**Best-effort paths:**
- Any `catch` block that intentionally swallows errors must include a comment explaining why:
```js
} catch {
  // Best-effort metric path.
}

} catch {
  // Hourly analytics are best-effort and must not affect requests.
}
```

**Error classification:**
- `classifyFailure({ error, source, reason })` in `observability/events.js` normalizes any error to `{ source, cause }`.
- Used by all boundary layers before emitting telemetry.

## Logging

**Framework:** Pino, via `observability/logger.js` (`getLogger({ component })`).

**Pattern:**
- All structured log output flows through `emitEvent(logger, eventName, payload)` in `observability/events.js`.
- Never call `logger.info` or `console.log` directly — use `emitTelemetry` or `emitEvent`.
- Event names come from the `EVENTS` enum: `request.start`, `policy.decision`, `dependency.attempt`, `dependency.failure`, `request.degraded`, `request.complete`.
- Sensitive headers (tokens, raw IPs in log payloads) are not included — IPs are redacted in output layers.
- Correlation ID automatically attached to every event via `getCorrelationId()` (AsyncLocalStorage).

## Comments

**When to comment:**
- Named operational phases in a handler (e.g., `// 1. Time Window Check`, `// Enforce HTTPS`).
- Best-effort catch blocks (required — see Error Handling above).
- Non-obvious invariants or workarounds.

**When not to comment:**
- Self-descriptive function calls or standard patterns.

**JSDoc/TSDoc:**
- Not used anywhere in the codebase. Keep function names and parameter names self-descriptive.

## Function Design

**Size:**
- Keep each function focused on one responsibility.
- Orchestration functions (like `handleStreamRequest`, `applyRequestControls`) delegate to focused sub-functions.

**Parameters:**
- Pass primitives and plain objects directly.
- No implicit globals except module-level constants and the two module-level Maps in `stream-route.js` (in-flight deduplication).

**Return Values:**
- Return explicit JSON-serializable objects.
- Use `{ handled, outcome }` for route handlers (see Handler Return Shape above).
- Use `{ allowed, reason, ... }` for policy decisions.
- Use `{ status, url, title }` or `{ status, cause }` for stream resolution results.

## Module Design

**Exports:**
- Named exports only: `module.exports = { fn1, fn2 }`.
- Do not attach properties to exported interfaces after the fact.

**Import Direction:**
- Follow `modules/BOUNDARIES.md` strictly:
  - `routing` → `policy`, `integrations`, `analytics`, `presentation`, `observability`.
  - `policy` → pure utilities only (no service clients).
  - `integrations` → transport utilities only.
  - `presentation` → no service client imports.
  - Never: `integrations` → `presentation`, `policy` → `routing`, `presentation` → `integrations`.

---

*Convention analysis: 2026-02-25*
