# Technology Stack

**Analysis Date:** 2026-02-21

## Languages

**Primary:**
- JavaScript (Node.js CommonJS) - runtime and addon logic in `serverless.js` and `addon.js`

**Secondary:**
- HTML/CSS (inline template strings) - landing and diagnostics pages rendered from `serverless.js`

## Runtime

**Environment:**
- Node.js (version not pinned in repo) - app entry uses `node serverless.js` in `package.json`

**Package Manager:**
- npm (inferred from `package.json`)
- Lockfile: missing (`package-lock.json`, `pnpm-lock.yaml`, and `yarn.lock` not present)

## Frameworks

**Core:**
- `stremio-addon-sdk` `^1.6.10` - addon manifest, catalog handler, stream handler, and router in `addon.js` and `serverless.js`

**Testing:**
- Not detected (no test framework config files found)

**Build/Dev:**
- Vercel Node runtime via `@vercel/node` build target in `vercel.json`
- No separate transpile/bundling step; source executes directly in Node from `serverless.js`

## Key Dependencies

**Critical:**
- `stremio-addon-sdk` `^1.6.10` - required to expose Stremio-compatible manifest/catalog/stream endpoints in `addon.js`

**Infrastructure:**
- Native `fetch` and `URL` APIs - outbound HTTP to Broker and Redis REST endpoints in `addon.js` and `serverless.js`

## Configuration

**Environment:**
- Configure broker endpoint with `B_BASE_URL` consumed in `addon.js`
- Configure Redis REST with `KV_REST_API_URL` + `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` consumed in `serverless.js`
- `.env` files are not detected in repository root; provide env vars through deployment/runtime configuration

**Build:**
- Deployment routing and runtime config in `vercel.json`
- Package metadata and startup script in `package.json`

## Platform Requirements

**Development:**
- Node.js environment with global `fetch` support and ability to run `node serverless.js` from `package.json`
- Network access to broker API (`B_BASE_URL`) and Upstash/Vercel KV REST endpoint configured in `serverless.js`

**Production:**
- Vercel Serverless Function deployment target using `serverless.js` as single entrypoint (`vercel.json`)
- Runtime environment variables configured in host platform for broker and Redis credentials

---

*Stack analysis: 2026-02-21*
