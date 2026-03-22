# Phase 37 Research: HTTP Contract Hardening (Server A)

**Generated:** 2026-03-22
**Phase:** 37-http-contract-hardening
**Requirements in scope:** HCON-01, HCON-02, HCON-03

## Objective

Determine concrete, evidence-backed header values and implementation points for JSON content type, CORS preflight caching, and manifest cache policy in Server A (`add-jipi`).

## Locked Inputs from Context

- HCON-01 must be implemented at the single JSON exit point: `sendJson()` in `modules/routing/http-handler.js`.
- HCON-02 must preserve existing `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers` behavior while adding explicit 204 contract fields.
- HCON-03 must be implemented in code (not `vercel.json`) by intercepting `/manifest.json` before `runtimeRouter` handles the request.

## External Findings

### CORS Preflight Caching (`Access-Control-Max-Age`)

Evidence:
- MDN `Access-Control-Max-Age` notes browser caps: Chromium caps at 7200s, Firefox caps at 86400s, default is 5s.
- MDN CORS guide confirms preflight responses are cacheable via `Access-Control-Max-Age` and avoid repeated OPTIONS round-trips.

Decision:
- Use `Access-Control-Max-Age: 7200`.

Rationale:
- 7200s is the effective maximum in Chromium-based clients (common browser baseline).
- Higher values provide no additional Chromium benefit and slow policy propagation.
- 7200s still materially reduces repeat preflight latency and Vercel function invocations.

### Preflight 204 Body Contract (`Content-Length`)

Evidence:
- HTTP/204 semantics expect no body; explicit `Content-Length: 0` is a broadly compatible way to avoid intermediary/proxy ambiguity.
- Prior v9 findings already linked missing `Content-Length: 0` to Safari-family preflight instability.

Decision:
- Set `Content-Length: 0` on successful and blocked-origin preflight 204 responses.

Rationale:
- Keeps all 204 preflight exits deterministic and avoids split behavior between allowed and blocked-origin branches.

### Manifest Caching (`Cache-Control`)

Evidence:
- v9 research summary identifies missing manifest cache policy as a cold-start amplifier and recommends short TTL caching.
- `stremio-addon-sdk` `serveHTTP(..., { cacheMaxAge })` exists specifically to control manifest/resource cache behavior, indicating manifest caching is expected in Stremio addon serving patterns.
- MDN Cache-Control guidance: `max-age` controls freshness; `must-revalidate` prevents stale reuse once freshness expires.

Decision:
- Use `Cache-Control: public, max-age=300, must-revalidate` on `/manifest.json` responses.

Rationale:
- 5-minute TTL reduces repeated manifest cold hits while still allowing fast rollout of contract updates.
- `must-revalidate` limits stale reuse risk after TTL.
- Avoid `stale-while-revalidate` in this phase because the goal prioritizes deterministic contract updates over serving stale manifest metadata.

## Implementation Guidance

- HCON-01: change `sendJson()` header to `application/json; charset=utf-8`.
- HCON-02:
  - in `handlePreflight()`, add `Content-Length: 0` to both 204 branches,
  - add `Access-Control-Max-Age: 7200` on allowed preflight 204 responses.
- HCON-03:
  - inside `createHttpHandler()` before calling `runtimeRouter`, detect `pathname === "/manifest.json"` and set `Cache-Control` before delegating.

## Validation Architecture

1. Contract tests must assert exact headers for:
   - JSON success/error responses (`Content-Type: application/json; charset=utf-8`),
   - OPTIONS allowed + blocked-origin responses (204 + `Content-Length: 0`; allowed branch includes `Access-Control-Max-Age: 7200`),
   - manifest response includes exact `Cache-Control` directive string.
2. Tests should run with Node `node:test` (`node --test`) and complete under 60 seconds.
3. Plan verification must include frontmatter + structure checks and requirement mapping checks.

## Recommended Commands for Implementation Phase

- `node --test tests/contract-http-headers.test.js`
- `node "../.opencode/get-shit-done/bin/gsd-tools.cjs" frontmatter validate ".planning/phases/37-http-contract-hardening/37-01-PLAN.md" --schema plan`
- `node "../.opencode/get-shit-done/bin/gsd-tools.cjs" frontmatter validate ".planning/phases/37-http-contract-hardening/37-02-PLAN.md" --schema plan`
