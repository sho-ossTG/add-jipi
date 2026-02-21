# Phase 1: Contract Compatibility Baseline - Research

**Researched:** 2026-02-21
**Domain:** Stremio addon protocol contract compatibility (`manifest`, `catalog`, `stream`) on `stremio-addon-sdk`
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
### Baseline compatibility guardrail
- `serverless.js` is source of truth for current Phase 1 behavior decisions where code already defines policy.
- Keep baseline-compatible behavior in this phase; improvements beyond baseline are deferred unless strictly non-breaking and within phase boundary.

### Reliability behavior (locked from current implementation)
- Reliability policy follows current hybrid behavior: stream routes prefer protocol-safe stream responses; non-stream paths return JSON errors/statuses.
- Fallback eligibility follows current stream handling: fallback stream is used for control blocks, broker/resolve failures, HTTPS-invalid resolved URLs, and top-level stream errors.
- Retry behavior remains current: no explicit retry loop before responding.
- User preference captured for direction: correctness over continuity (prefer clear failure over uncertain/stale fallback), but baseline behavior remains fixed in this phase.

### Client-visible performance preferences
- Prefer predictable response bands over fastest-but-spiky behavior.
- Use moderate dependency wait budget (balanced success chance vs client wait time).
- Prioritize manifest/catalog responsiveness.
- Client-facing performance failures should be actionable (not only generic unavailable text).

### Caching behavior preferences
- Prefer fresh resolution over aggressive cache reuse.
- Cache reuse should stay constrained to exact episode and same client identity context.
- Do not serve uncertain stale data; fail clearly instead.
- Provide light client-facing indication when degraded/cached behavior is in effect.

### Error and observability contract preferences
- Keep current mixed error shape in Phase 1 for compatibility.
- Favor dual-format signaling where possible: stable machine-meaning + short human-readable message.
- Do not expose correlation IDs publicly in this phase.
- Client-visible error granularity should be mid-level (e.g., timeout/upstream/capacity/policy categories), not over-technical internals.

### Claude's Discretion
- Exact wording style for actionable error messages.
- Which non-breaking compatibility checks are best validated first in planning order.
- How to represent light degraded/cached hints without changing protocol compatibility.

### Deferred Ideas (OUT OF SCOPE)
- Shift stream behavior from continuity-biased fallback toward correctness-biased failure semantics where uncertainty exists.
- Introduce explicit retry/timeout policy tuning beyond current baseline behavior.
- Add standardized client-facing error contract (single normalized shape) once compatibility impact is assessed.
- Add explicit safe observability hints (including optional request tracing metadata) for support workflows.
- Expand caching strategy controls beyond baseline exact-match reuse rules.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONT-01 | User can install the addon and receive a valid `manifest.json` response compatible with Stremio clients. | Manifest field checklist, HTTPS/CORS transport requirements, install/test URL validation, and manifest schema pitfalls. |
| CONT-02 | User can browse catalog entries and receive valid catalog payloads for supported content. | `defineCatalogHandler` response contract (`{ metas: [] }` with valid Meta Preview objects), catalog ID/type matching, and pagination/search extra rules. |
| CONT-03 | User requesting a supported episode receives a protocol-valid stream response. | `defineStreamHandler` stream object contract, series episode ID shape, valid fallback stream response pattern, and stream behavior hints constraints. |
</phase_requirements>

## Summary

Phase 1 should focus on strict protocol compatibility at the HTTP boundary while preserving current behavior in `serverless.js` and `addon.js`. The stack is already aligned with standard Stremio addon practice: `stremio-addon-sdk` handles protocol routing and manifest exposure, while custom logic wraps reliability policy and fallback semantics.

The highest-value planning work is to create a compatibility checklist for `manifest`, `catalog`, and `stream` outputs and verify current responses against it before any behavior changes. This includes route/path correctness, CORS/HTTPS constraints, required object fields, and ensuring unsupported items return protocol-valid empty responses (not malformed payloads).

There is one likely compatibility risk to prioritize: current manifest catalog entries omit `catalogs[].name`, while current docs mark it required. Because behavior is already live, this should be treated as a first validation task (runtime verification in Stremio clients + conservative fix if needed).

**Primary recommendation:** Plan Phase 1 as a contract-hardening pass: baseline-preserving response validation, then minimal non-breaking schema fixes (especially manifest catalog metadata) and compatibility tests for install, catalog browse, and supported episode stream.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `stremio-addon-sdk` | `^1.6.10` (project dependency) | Manifest validation, protocol handlers, router generation (`getRouter`) | Official SDK for Stremio protocol; avoids custom protocol glue. |
| Node.js runtime | 18+ recommended | HTTP handler + `fetch` availability used by current code | Current code depends on global `fetch`; modern LTS runtime reduces polyfill risk. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Upstash Redis REST API | N/A (service) | Session/capacity state and cached active URL | Use for existing baseline control and fallback eligibility logic. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `stremio-addon-sdk` router + handlers | Custom Express/manual protocol routes | More control, but higher contract-risk and more hand-rolled protocol/CORS logic. |
| Raw protocol-only static endpoints | SDK builder + router (current) | Static can be simpler for fixed catalogs, but weaker for dynamic stream resolution and policy logic. |

**Installation:**
```bash
npm install stremio-addon-sdk@^1.6.10
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── contract/          # manifest/catalog/stream schema checks and response guards
├── handlers/          # route-specific handlers (manifest, catalog, stream)
├── policy/            # request controls, session/capacity, fallback decisions
└── integrations/      # broker and Redis integration boundaries
```

### Pattern 1: SDK-first protocol boundary, custom policy wrapper
**What:** Keep `getRouter(addonInterface)` as the protocol contract boundary; apply custom policy checks before stream routing.
**When to use:** When preserving baseline behavior while hardening compatibility.
**Example:**
```javascript
// Source: https://raw.githubusercontent.com/Stremio/addon-helloworld/master/README.md
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");

const router = getRouter(addonInterface);
module.exports = function (req, res) {
  router(req, res, function () {
    res.statusCode = 404;
    res.end();
  });
};
```

### Pattern 2: Contract-valid empty responses for unsupported resources
**What:** Return `{ metas: [] }` or `{ streams: [] }` when request is unsupported.
**When to use:** Any ID/type mismatch outside supported One Piece episodes.
**Example:**
```javascript
// Source: https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/api/requests/defineStreamHandler.md
builder.defineStreamHandler(function(args) {
  if (args.type === "movie" && args.id === "tt1254207") {
    return Promise.resolve({ streams: [{ url: "https://..." }] });
  }
  return Promise.resolve({ streams: [] });
});
```

### Anti-Patterns to Avoid
- **Manual protocol reimplementation:** Do not replace SDK routing for Phase 1; increases compatibility surface and regressions.
- **Changing fallback semantics now:** Deferred by user constraints; keep current stream fallback eligibility unchanged.
- **Returning malformed error objects on resource routes:** Keep resource payloads contract-valid (`streams` / `metas` arrays) even during failure.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stremio route parsing and dispatch | Custom `/{resource}/{type}/{id}.json` parser | `getRouter(addonInterface)` | SDK tracks protocol shape and landing/manifest wiring. |
| Manifest schema guardrails | Ad-hoc key checks | `new addonBuilder(manifest)` constructor validation | Official validation path; fewer silent contract mistakes. |
| Stream source format compatibility | Proprietary stream schema | Official Stream Object fields (`url`, `behaviorHints`, etc.) | Stream field semantics are client-sensitive and easy to break. |

**Key insight:** Most Phase 1 risk is at response-contract boundaries; SDK primitives are safer than custom protocol code.

## Common Pitfalls

### Pitfall 1: Incomplete manifest catalogs metadata
**What goes wrong:** Catalog may be declared without full expected fields (notably `catalogs[].name` in current docs).
**Why it happens:** Older examples often use minimal catalog objects.
**How to avoid:** Validate manifest against current docs and test install/load on desktop + web clients.
**Warning signs:** Addon installs but catalog behaves inconsistently or fails discoverability/UI labeling.

### Pitfall 2: Episode ID mismatch for series streams
**What goes wrong:** Stream handler misses valid requests due to wrong series video ID shape.
**Why it happens:** Series IDs are `imdb:season:episode` (e.g. `tt0898266:9:17`), not just base IMDB ID.
**How to avoid:** Keep explicit parsing/validation and supported-prefix checks before resolution.
**Warning signs:** Catalog item appears, but all stream requests return empty/error fallback.

### Pitfall 3: Breaking protocol on failure paths
**What goes wrong:** Non-contract failure payloads leak into resource routes.
**Why it happens:** Mixing generic API error shape with Stremio resource shape.
**How to avoid:** For stream routes, always return valid `streams` response object; for catalog routes, valid `metas` object.
**Warning signs:** Client fails to render streams/catalog, or logs parse/contract errors.

### Pitfall 4: HTTPS/CORS transport assumptions
**What goes wrong:** Addon loads locally but fails when remote-installed.
**Why it happens:** Stremio requires HTTPS for non-`127.0.0.1` URLs; CORS must allow origins.
**How to avoid:** Validate production manifest URL uses HTTPS and returns permissive CORS for protocol routes.
**Warning signs:** Install by URL fails remotely but works on localhost.

## Code Examples

Verified patterns from official sources and current project:

### Minimal contract-valid manifest + catalog + stream scope
```javascript
// Source: https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/protocol.md
const manifest = {
  id: "org.example.addon",
  version: "1.0.0",
  name: "Example",
  description: "Example addon",
  resources: ["catalog", "stream"],
  types: ["series"],
  catalogs: [{ type: "series", id: "example_catalog", name: "Example Catalog" }],
  idPrefixes: ["tt"]
};
```

### Catalog handler contract
```javascript
// Source: https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/api/requests/defineCatalogHandler.md
builder.defineCatalogHandler(function(args) {
  if (args.type !== "series" || args.id !== "example_catalog") {
    return Promise.resolve({ metas: [] });
  }
  return Promise.resolve({
    metas: [{
      id: "tt0388629",
      type: "series",
      name: "One Piece",
      poster: "https://images.metahub.space/poster/medium/tt0388629/img"
    }]
  });
});
```

### Stream fallback remains protocol-valid
```javascript
// Source: serverless.js (project baseline)
function sendErrorStream(res, title) {
  sendJson(res, 200, {
    streams: [formatStream(`⚠️ ${title}`, TEST_VIDEO_URL)]
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `stream.title` used as stream description | `stream.description` preferred; `title` noted for deprecation path | Current docs (ongoing deprecation note) | New work should avoid deep dependence on `title` semantics long-term. |
| Broad, implicit addon schema assumptions | Explicit manifest/resource docs with cache and behavior hints | Evolved in SDK docs | Contract checks should be explicit in planning and tests. |

**Deprecated/outdated:**
- `meta.genres`, `meta.director`, `meta.cast` are documented with deprecation warnings toward links-based modeling.
- Stream UI should move from `stream.title` toward `stream.description` over time (not required to change in this phase).

## Open Questions

1. **Is `catalogs[].name` enforced by current Stremio clients or only recommended by docs?**
   - What we know: Current docs mark `name` required; current code omits it.
   - What's unclear: Whether omission causes hard failure vs soft UI degradation in target clients.
   - Recommendation: Add explicit compatibility verification step first; if uncertain, add non-breaking `name` values immediately.

2. **Should non-stream Stremio-route failures return `503` JSON or contract-empty payloads?**
   - What we know: Current baseline uses `503` JSON for blocked non-stream routes, stream routes remain contract-safe.
   - What's unclear: Any client-specific intolerance to non-200 on catalog calls in practice.
   - Recommendation: Keep baseline in Phase 1, but add test matrix for blocked-state catalog/manifest behavior.

## Sources

### Primary (HIGH confidence)
- `https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/protocol.md` - protocol routes, CORS rule, transport expectations
- `https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/api/responses/manifest.md` - manifest schema and filtering/categorization properties
- `https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/api/requests/defineCatalogHandler.md` - catalog request/response contract
- `https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/api/requests/defineStreamHandler.md` - stream request/response contract and series ID shape
- `https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/api/responses/stream.md` - stream object field contract
- `https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/api/responses/meta.md` - meta preview requirements used by catalogs

### Secondary (MEDIUM confidence)
- `https://stremio.github.io/stremio-addon-sdk/` - SDK usage overview and API index
- `https://www.npmjs.com/package/stremio-addon-sdk` - published package/version and HTTPS/CORS note in README
- `https://raw.githubusercontent.com/Stremio/addon-helloworld/master/README.md` - canonical serverless/router baseline patterns

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - directly verified from project dependency and official SDK docs.
- Architecture: MEDIUM - based on official patterns plus current code constraints; final fit depends on planner scope boundaries.
- Pitfalls: MEDIUM - largely verified by docs and current code diff, but some client-behavior outcomes require runtime validation.

**Research date:** 2026-02-21
**Valid until:** 2026-03-23
