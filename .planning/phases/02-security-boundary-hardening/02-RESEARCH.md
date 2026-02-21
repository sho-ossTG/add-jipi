# Phase 2: Security Boundary Hardening - Research

**Researched:** 2026-02-22
**Domain:** Security boundaries for Node.js serverless Stremio addon routes (authz, trusted client attribution, redaction, CORS)
**Confidence:** MEDIUM

<user_constraints>
## User Constraints

### Locked Decisions
- Phase scope is `Phase 2: Security Boundary Hardening` only.
- This phase MUST satisfy `SECU-01`, `SECU-02`, `SECU-03`, and `SECU-04`.
- No phase `CONTEXT.md` exists; planning must derive constraints from requirements and existing codebase patterns.

### Claude's Discretion
- Choose concrete operator authn/authz mechanism and middleware structure compatible with current `serverless.js` architecture.
- Choose CORS strategy that satisfies security requirements while preserving addon compatibility.
- Choose redaction strategy for diagnostics payloads and error responses.

### Deferred Ideas (OUT OF SCOPE)
- Reliability controls (`RELY-*`), observability expansion (`OBSV-*`), and modularization/test-governance (`MAINT-*`) beyond what is directly required to satisfy Phase 2 security requirements.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SECU-01 | Operator can access diagnostics routes only after authenticated and authorized admin checks. | Route classification pattern (`public` vs `operator`), constant-time credential checks, deny-by-default middleware placement before diagnostics handlers. |
| SECU-02 | User requests are attributed to trusted client identity, not spoofable forwarded headers. | Trusted proxy attribution via `proxy-addr` and platform header policy (Vercel overwrites `X-Forwarded-For`), with strict fallback and IP normalization. |
| SECU-03 | Sensitive diagnostics data is redacted so public routes never expose raw IPs or internal error details. | Centralized redaction helpers for diagnostics rows and global error shaping (generic client messages, detailed server-side logs only). |
| SECU-04 | Browser clients only receive CORS permissions for explicitly allowed origins and headers. | Origin allowlist + explicit preflight (`OPTIONS`) responses, no wildcard `Access-Control-Allow-Headers`, and `Vary: Origin` when dynamic origin reflection is used. |
</phase_requirements>

## Summary

The current implementation has direct exposure at the security boundary: `/health` and `/quarantine` are unauthenticated, diagnostics output includes raw IP and raw upstream error strings, and CORS headers are currently wildcard (`*`) for all JSON responses. This directly conflicts with the Phase 2 requirements for operator-only access, trusted attribution, sensitive data redaction, and explicit CORS policy.

The safest planning approach is to harden at a single HTTP boundary in `serverless.js`: classify routes, enforce authn/authz before operator handlers, derive client identity through trusted proxy logic (not ad-hoc header parsing), and centralize response builders so diagnostics/public responses are consistently sanitized. Keep `stremio-addon-sdk` routing (`getRouter`) as-is for protocol compatibility; wrap security behavior around existing handlers.

There is one important compatibility tension to resolve early: Stremio protocol docs state HTTP routes should allow all origins, while Phase 2 requirement `SECU-04` requires explicit CORS allowlists. Planning should treat this as a design decision checkpoint and define which routes (all vs browser-only surfaces) require strict allowlists.

**Primary recommendation:** Implement a boundary middleware layer in `serverless.js` that enforces operator auth, trusted IP attribution (`proxy-addr`), centralized redaction, and explicit CORS allowlists before route handlers execute.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `stremio-addon-sdk` | `1.6.10` | Protocol routing for `/manifest.json`, `/catalog/*`, `/stream/*` | Official Stremio integration layer already used by project; avoids hand-rolled protocol parser. |
| `proxy-addr` | `2.0.7` | Trusted proxy-aware client IP extraction from `X-Forwarded-For` chains | Standard Node/Express ecosystem utility for spoof-resistant attribution when trust boundaries are explicit. |
| `node:crypto` | built-in | Constant-time credential comparison with `timingSafeEqual` | Prevents timing side-channels in token comparison without external dependency. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:test` | built-in | Security boundary regression tests | Use for route authz, redaction, and CORS preflight/allowlist test coverage. |
| Vercel request headers contract | current docs | Deployment-aware trust model for forwarded IP headers | Use when defining production client attribution policy (`x-forwarded-for` overwrite behavior). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Static admin token in header | Signed JWT/OIDC operator auth | Better long-term identity lifecycle, but larger Phase 2 blast radius and infra setup overhead. |
| `proxy-addr` trust function | Manual split/parse of `X-Forwarded-For` | Manual parsing is easy to get wrong with IPv6/proxy chains and weak trust checks. |
| Single global wildcard CORS | Per-route explicit origin/header allowlists | Wildcard is simpler but fails `SECU-04`; explicit allowlists require route policy matrix and preflight tests. |

**Installation:**
```bash
npm install proxy-addr@2.0.7
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── security/
│   ├── auth.js          # operator credential validation + authorization gates
│   ├── attribution.js   # trusted client identity extraction
│   ├── cors.js          # allowlist + preflight handling
│   └── redact.js        # diagnostics/public redaction helpers
├── handlers/
│   ├── diagnostics.js   # /health, /quarantine operator handlers
│   └── stremio.js       # manifest/catalog/stream dispatch wrappers
└── server.js            # route classification + middleware pipeline
```

### Pattern 1: Route classification with deny-by-default operator surfaces
**What:** Define route classes (`public`, `stremio`, `operator`) and enforce authn/authz for `operator` before handlers.
**When to use:** Any route exposing diagnostics, operational metrics, or internals.
**Example:**
```javascript
// Source: project pattern in serverless.js + Phase 2 hardening direction
const routeClass = classifyRoute(pathname); // "public" | "stremio" | "operator"

if (routeClass === "operator") {
  const decision = authorizeOperator(req);
  if (!decision.allowed) return sendJson(res, 403, { error: "forbidden" });
}
```

### Pattern 2: Trusted attribution via proxy trust policy
**What:** Use `proxy-addr` with compiled trust configuration instead of raw header parsing.
**When to use:** Any logic keyed by client identity (session slots, rate limits, diagnostics correlation).
**Example:**
```javascript
// Source: https://raw.githubusercontent.com/jshttp/proxy-addr/master/README.md
const proxyaddr = require("proxy-addr");
const trust = proxyaddr.compile(["loopback", "linklocal", "uniquelocal"]);

function getTrustedClientIp(req) {
  return proxyaddr(req, trust);
}
```

### Pattern 3: Centralized redaction and error shaping
**What:** Sanitize diagnostics payloads and return generic public error bodies; keep internal detail server-side only.
**When to use:** Any response containing event logs, IP fields, exception messages, or dependency internals.
**Example:**
```javascript
// Source: OWASP Error Handling + Logging cheat sheets (generic message + server-side detail)
function toPublicError() {
  return { error: "service_unavailable" };
}

function redactIp(ip) {
  return ip ? "[redacted]" : "unknown";
}
```

### Pattern 4: Explicit CORS allowlist with preflight handler
**What:** For browser-facing routes, reflect origin only if allowlisted; return explicit allow headers/methods and `Vary: Origin`.
**When to use:** Any route expected to be called by browsers across origins.
**Example:**
```javascript
// Source: MDN CORS guide
if (allowedOrigins.has(origin)) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
```

### Anti-Patterns to Avoid
- **Raw `x-forwarded-for` first-element trust:** current pattern is spoof-prone outside strict proxy guarantees.
- **Wildcard CORS everywhere:** fails explicit allowlist requirement and broadens attack surface.
- **Returning `err.message` to public clients:** leaks internal dependency and stack-context details.
- **Diagnostics endpoints outside auth gate:** creates direct operator-surface exposure.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Proxy-chain parsing/trust logic | Manual string splitting for `X-Forwarded-For` | `proxy-addr` trust function | Correct handling of chain order, CIDRs, IPv6, and trust boundaries is easy to get wrong. |
| Secret comparison | `===` token compare | `crypto.timingSafeEqual` | Prevents timing side-channels on credential checks. |
| Ad-hoc per-handler redaction | Copy-pasted string masking in each route | Centralized `redact*` helpers | Ensures consistent sanitization and easier audit coverage. |

**Key insight:** Security boundary bugs usually come from inconsistent edge handling, not core business logic; central primitives reduce drift.

## Common Pitfalls

### Pitfall 1: Confusing infrastructure-provided headers with trusted client input
**What goes wrong:** Attribution accepts attacker-influenced forwarded headers.
**Why it happens:** Header parsing is implemented as string logic without explicit trust policy.
**How to avoid:** Bind attribution to deployment trust model (`proxy-addr` + known proxy assumptions); reject malformed/unknown address values.
**Warning signs:** Same client can change identity by tweaking forwarded headers in tests.

### Pitfall 2: Protecting HTML page but leaving JSON diagnostics open
**What goes wrong:** `/quarantine` or `/health` data is reachable anonymously.
**Why it happens:** Auth checks are route-local instead of centralized route class middleware.
**How to avoid:** Classify routes once and enforce authz before calling diagnostics handlers.
**Warning signs:** `curl` without credentials still receives diagnostics content.

### Pitfall 3: Redacting UI table cells but leaking raw values in JSON/errors
**What goes wrong:** Raw IPs/internal error messages still leak via alternate response paths.
**Why it happens:** Redaction implemented only in one renderer (e.g., HTML rows) not in shared data model.
**How to avoid:** Redact before serialization; expose only safe fields to public routes.
**Warning signs:** Public 5xx bodies include upstream exception text.

### Pitfall 4: CORS preflight mismatch despite allowlist
**What goes wrong:** Browser calls fail due to missing `OPTIONS` handling or missing requested header in allowlist.
**Why it happens:** Only `Access-Control-Allow-Origin` is set; preflight contract not fully implemented.
**How to avoid:** Add explicit `OPTIONS` handling and return full allowed methods/headers.
**Warning signs:** Browser devtools shows preflight failure while direct curl works.

### Pitfall 5: Requirement tension between Stremio CORS guidance and strict allowlists
**What goes wrong:** Over-tightening CORS may break Stremio clients expecting permissive CORS; over-permissive CORS fails security requirement.
**Why it happens:** Protocol compatibility and enterprise hardening goals can conflict.
**How to avoid:** Decide route-level policy matrix early and validate on target Stremio clients before rollout.
**Warning signs:** Install/stream works in native client but fails in web, or vice versa.

## Code Examples

Verified patterns from docs and ecosystem references:

### Trusted proxied client address
```javascript
// Source: https://raw.githubusercontent.com/jshttp/proxy-addr/master/README.md
const proxyaddr = require("proxy-addr");
const trust = proxyaddr.compile("loopback");

function getClientIp(req) {
  return proxyaddr(req, trust);
}
```

### Constant-time credential check
```javascript
// Source: https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b
const crypto = require("node:crypto");

function secureEquals(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
```

### Explicit CORS preflight response
```javascript
// Source: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
if (req.method === "OPTIONS") {
  res.statusCode = 204;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Vary", "Origin");
  res.end();
  return;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Trusting raw forwarded headers by convention | Explicit proxy trust policy + parsed client attribution | Matured across modern proxy/serverless deployments | Reduces spoofing risk and attribution ambiguity. |
| Returning internal error details to clients for debugging | Generic external errors + detailed internal logging | Long-standing OWASP guidance | Limits reconnaissance value for attackers. |
| Wildcard CORS by default | Explicit route-level origin/header allowlists (especially for browser APIs) | Browser security and production hardening norms | Reduces cross-origin exposure and misconfiguration risk. |

**Deprecated/outdated:**
- Manual `x-forwarded-for` string parsing as the only trust mechanism.
- Wildcard `Access-Control-Allow-Headers: *` for authenticated browser APIs.

## Open Questions

1. **How should `SECU-04` be reconciled with Stremio protocol guidance to allow all origins on addon routes?**
   - What we know: Stremio protocol doc says HTTP routes should allow all origins; requirement says explicit allow origins/headers.
   - What's unclear: Whether strict allowlist on manifest/catalog/stream breaks target client matrix.
   - Recommendation: Define route policy matrix (`stremio routes` vs `operator/public web routes`) and validate with Stremio desktop/web before lock-in.

2. **What operator auth mechanism is acceptable for this project stage?**
   - What we know: Requirements mandate authenticated+authorized admin checks, but no identity provider is mandated.
   - What's unclear: Whether static token auth is acceptable for production policy.
   - Recommendation: Start Phase 2 with static secret + role claim via env config, designed behind a pluggable `authorizeOperator()` interface.

3. **Should `/health` be public-liveness only or operator-only diagnostics?**
   - What we know: Current `/health` reveals Redis connectivity detail; requirement language groups diagnostics/admin surfaces under authorization.
   - What's unclear: Operational need for unauthenticated uptime probes.
   - Recommendation: Split to minimal public liveness (`ok` only) and operator health details behind auth.

## Sources

### Primary (HIGH confidence)
- `https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/protocol.md` - Stremio route contract and CORS guidance.
- `https://vercel.com/docs/headers/request-headers` - Vercel header semantics (`x-forwarded-for` overwrite behavior, proxy trust implications).
- `https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS` - CORS preflight and explicit allow header/origin behavior.
- `https://raw.githubusercontent.com/jshttp/proxy-addr/master/README.md` - Trusted proxy IP attribution API and trust function model.
- `https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html` - Sensitive logging/redaction guidance.
- `https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html` - Generic external error responses and internal logging pattern.

### Secondary (MEDIUM confidence)
- `https://expressjs.com/en/guide/behind-proxies.html` - Proxy trust model rationale and pitfalls; useful conceptual backing for non-Express Node middleware.
- Current project code (`serverless.js`, `tests/*.test.js`) - Existing boundary behavior and regression test style.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - direct verification from project dependencies and official docs.
- Architecture: MEDIUM - strong evidence for patterns, but auth mechanism specifics depend on operator policy decision.
- Pitfalls: MEDIUM - verified against current code and docs; final CORS policy depends on unresolved Stremio compatibility decision.

**Research date:** 2026-02-22
**Valid until:** 2026-03-24
