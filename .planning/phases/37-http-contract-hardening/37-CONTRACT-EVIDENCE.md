# Phase 37 HTTP Contract Evidence

## HCON-01

- Requirement: JSON responses expose explicit UTF-8 content type.
- Implementation: `modules/routing/http-handler.js` in `sendJson()`.
- Header contract: `Content-Type: application/json; charset=utf-8`.
- Automated test: `JSON health responses include utf-8 content type` in `tests/contract-http-headers.test.js`.
- Command: `node --test tests/contract-http-headers.test.js`.
- Rationale reference: `37-RESEARCH.md` "JSON Content-Type" implementation guidance (`application/json; charset=utf-8`).

## HCON-02

- Requirement: OPTIONS preflight responses are deterministic and cacheable.
- Implementation: `modules/routing/http-handler.js` in `handlePreflight()`.
- Header contracts:
  - `Content-Length: 0` on allowed-origin and blocked-origin 204 responses.
  - `Access-Control-Max-Age: 7200` on allowed-origin preflight responses.
  - Existing behavior preserved: `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers`.
- Automated tests:
  - `OPTIONS preflight for allowed origin is deterministic and cacheable`
  - `OPTIONS preflight for blocked origin still returns deterministic 204 envelope`
  - Located in `tests/contract-http-headers.test.js`.
- Command: `node --test tests/contract-http-headers.test.js`.
- Rationale reference: `37-RESEARCH.md` sections "CORS Preflight Caching (`Access-Control-Max-Age`)" and "Preflight 204 Body Contract (`Content-Length`)".

## HCON-03

- Requirement: Manifest responses expose explicit bounded cache policy.
- Implementation: `modules/routing/http-handler.js` in `createHttpHandler()` before `runtimeRouter(req, res, ...)`.
- Header contract: `Cache-Control: public, max-age=300, must-revalidate` when `pathname === "/manifest.json"`.
- Automated tests:
  - `manifest responses expose explicit cache-control policy`
  - `non-manifest stremio routes are not forced to use manifest cache-control`
  - Located in `tests/contract-http-headers.test.js`.
- Command: `node --test tests/contract-http-headers.test.js`.
- Rationale reference: `37-RESEARCH.md` section "Manifest Caching (`Cache-Control`)".

## How to re-verify

```bash
node --test tests/contract-http-headers.test.js
node "../.opencode/get-shit-done/bin/gsd-tools.cjs" frontmatter validate ".planning/phases/37-http-contract-hardening/37-01-PLAN.md" --schema plan
node "../.opencode/get-shit-done/bin/gsd-tools.cjs" verify plan-structure ".planning/phases/37-http-contract-hardening/37-01-PLAN.md"
node "../.opencode/get-shit-done/bin/gsd-tools.cjs" frontmatter validate ".planning/phases/37-http-contract-hardening/37-02-PLAN.md" --schema plan
node "../.opencode/get-shit-done/bin/gsd-tools.cjs" verify plan-structure ".planning/phases/37-http-contract-hardening/37-02-PLAN.md"
```
