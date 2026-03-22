# Phase 37: HTTP Contract Hardening - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Server A emits consistent, explicit HTTP contracts for JSON responses, OPTIONS preflight, and manifest caching behavior. Goal is to reduce client compatibility failures and avoid avoidable preflight latency. No new capabilities — this is header hardening only. Covers: `sendJson()`, `handlePreflight()`, and the manifest route served by stremio-addon-sdk's `runtimeRouter`.

</domain>

<decisions>
## Implementation Decisions

### JSON Content-Type (HCON-01)
- Claude's Discretion: Use the correct spec value `application/json; charset=utf-8` on all JSON responses.
- Single fix point: `sendJson()` in `modules/routing/http-handler.js` — all JSON exits go through it.
- Apply to success AND error paths (both use `sendJson()`).

### Preflight Response Shape (HCON-02)
- Claude's Discretion: Add `Content-Length: 0` explicitly to 204 preflight responses (spec-compliant, prevents some proxy bugs).
- Claude's Discretion: Choose `Access-Control-Max-Age` value based on internet research — find what Stremio clients (browser, Android TV, desktop) actually respect and what value balances preflight latency vs. CORS policy update propagation. Research must include: browser default limits (Chrome caps at 7200s, Firefox at 86400s), Stremio client behavior if known, and any relevant CDN interaction.
- Claude's Discretion: Decide whether blocked-origin preflights (no/unknown Origin) should get `Content-Length: 0` — current code returns bare 204 for these; align with spec recommendation.
- The `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers` headers are already set in `handlePreflight()` — do not regress them.

### Manifest Cache-Control (HCON-03)
- Claude's Discretion: Choose the Cache-Control policy for `/manifest.json` based on internet research — find: what Stremio clients (browser, Android, desktop) do with manifest caching headers, what TTL range avoids re-fetching on every cold start without serving stale contracts for too long, and whether `stale-while-revalidate` or `s-maxage` are useful here.
- Inject via response interception before `runtimeRouter` handles the route (read the manifest path, set header before delegating) — not via vercel.json (keep Vercel config minimal).
- Research must establish the optimal value with justification, not just pick an arbitrary number.

### Claude's Discretion
- Exact `Access-Control-Max-Age` seconds value (must be research-backed).
- Exact `Cache-Control` directive string for manifest (must be research-backed with Stremio client behavior evidence).
- Whether to add `Vary: Accept-Encoding` or other secondary headers — only if research shows clear benefit.
- Charset injection syntax and test coverage approach.
- How to intercept manifest response to inject Cache-Control (wrapper before `runtimeRouter` or header pre-set before SDK handles it).

</decisions>

<specifics>
## Specific Ideas

- User explicitly delegated all implementation decisions to Claude + research — no specific visual or behavioral preferences stated.
- Research directive: find real-world values used by similar Stremio addons and browser/client CORS cache behavior docs, not just spec defaults.
- Planning agents must search the internet to justify every header value with evidence.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `sendJson(req, res, statusCode, payload)` in `modules/routing/http-handler.js:159` — single JSON exit point. HCON-01 fix lives here.
- `handlePreflight(req, res)` in `modules/routing/http-handler.js:169` — preflight handler. HCON-02 fix lives here.
- `applyCors(req, res, pathnameInput)` — sets `Access-Control-Allow-Origin`. Called by `sendJson` and `handlePreflight`. Does NOT set Allow-Methods/Allow-Headers on non-preflight responses (intentional).
- `runtimeRouter` (stremio-addon-sdk's `getRouter()`) — handles `/manifest.json`. No Cache-Control set today. HCON-03 fix requires intercepting before this router runs.
- `getCorsPolicy()` — reads `CORS_ALLOW_ORIGINS`, `CORS_ALLOW_HEADERS`, `CORS_ALLOW_METHODS` env vars with defaults.

### Established Patterns
- All JSON responses exit through `sendJson()` — one change point for HCON-01.
- `handlePreflight` returns `true` early, preventing any further route handling for OPTIONS requests.
- No Cache-Control headers are set anywhere in the codebase today.
- `vercel.json` is minimal (`builds` + `routes` only) — do not add a `headers` block; inject in code instead.

### Integration Points
- HCON-01: `sendJson()` at `modules/routing/http-handler.js:159`
- HCON-02: `handlePreflight()` at `modules/routing/http-handler.js:169`
- HCON-03: Inside `createHttpHandler()` before `runtimeRouter(req, res, ...)` call — intercept if `pathname === "/manifest.json"` and set `Cache-Control` header before delegating to SDK router.

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 37-http-contract-hardening*
*Context gathered: 2026-03-22*
