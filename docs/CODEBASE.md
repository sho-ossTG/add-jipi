# Server A CODEBASE

Internal runtime walkthrough for `add-jipi` (Server A). This complements `add-jipi/docs/SERVER-TEMPLATE.md` by documenting file internals, function behavior, and implementation-ready insertion points for future ideas.

Function signature format used below: `functionName(params)`.

## Runtime Flow

1. `serverless.js` exports `createHttpHandler(req, res)`.
2. `modules/routing/http-handler.js` classifies route, applies policy/session controls, and delegates to:
   - operator routes (`modules/routing/operator-routes.js`)
   - public routes (`modules/presentation/public-pages.js`)
   - stream path (`modules/routing/stream-route.js`)
3. Stream path resolves through D (`modules/integrations/d-client.js`), applies dedup/session/share logic, and returns payload via `modules/presentation/stream-payloads.js`.
4. Observability modules (`observability/*.js`) provide correlation context, structured events, reliability counters, and operator-safe projections.

## Runtime Files and Function Inventory

### `serverless.js`
- `createHttpHandler(req, res)` (imported export): Vercel entrypoint handler.
- Side effects/gotchas: no local logic; all behavior is in routing module.

### `addon.js`
- `resolveEpisode(episodeId)`: calls D client resolver and returns `{ url, title }` for stream construction.
- Stremio handlers (builder-defined async handlers):
  - catalog handler: returns One Piece catalog metadata.
  - stream handler: validates ID prefix, resolves episode via D, returns `{ streams: [...] }` or empty streams on failure.
- Return shape: Stremio addon interface object from `builder.getInterface()` with attached `resolveEpisode`.
- Gotcha: hardcoded `IMDB_ID = tt0388629` gate.

### `modules/routing/http-handler.js`
- `parsePositiveIntEnv(name, fallback)`: positive-int env parser with fallback.
- `emitTelemetry(eventName, payload = {})`: emits structured event through logger/events module.
- `redisCommand(command)`: wrapped Redis command with dependency attempt/failure telemetry.
- `redisEval(script, keys = [], args = [])`: passthrough Lua eval helper.
- `parseCsv(value)`: CSV parsing/trim/filter utility.
- `getTrustedProxy()`: compiles proxy trust list from env.
- `getTrustedClientIp(req)`: computes trusted client IP (proxy-aware fallback logic).
- `isStremioRoute(pathname)`: detects Stremio-facing paths.
- `isGatedStreamRoute(pathname)`: detects `/stream/*` paths for policy/reliability logging.
- `parseStreamEpisodeId(pathname)`: extracts encoded stream episode ID from route.
- `isBlockedStreamCause(cause)`: marks policy block causes.
- `normalizeStreamSummaryMode(cause)`: maps cause to stream summary mode.
- `normalizeStreamSummaryOutcome(result, cause)`: maps cause/result to success/degraded/blocked.
- `classifyRoute(pathname)`: classifies operator/stremio/public route buckets.
- `getCorsPolicy()`: builds CORS policy from env lists.
- `applyCors(req, res)`: applies CORS headers and Vary behavior.
- `sendJson(req, res, statusCode, payload)`: JSON response helper with CORS/correlation header binding.
- `handlePreflight(req, res)`: validates and serves OPTIONS CORS preflight.
- `sendPublicError(req, res, statusCode = 503)`: standardized public error envelope.
- `handlePublicRoute(req, res, pathname)`: handles `/` and `/health` public pages.
- `classifyReliabilityCause(errorOrReason)`: converts errors/reasons to normalized reliability causes.
- `normalizeReliabilityResult(statusCode, fallbackResult = "success")`: derives reliability result from status code.
- `normalizeReliabilitySource(source, cause)`: normalizes reliability source labels.
- `recordReliabilityOutcome(routeClass, payload = {})`: best-effort reliability counter increment.
- `getAddonInterface()`: lazy-loads addon interface.
- `buildStreamRouteDependencies()`: builds injected dependency bag for stream route.
- `createHttpHandler(req, res)`: main request orchestrator (operator/public/stream/router fallback, telemetry, reliability, degraded fallback).
- Inner helpers in main handler:
  - `setReliabilityOutcome(outcome = {})`: accumulates final reliability labels.
  - `sendStubAwareDegradedStream(causeInput)`: wraps degraded stream send with stub config.
- Return shape: writes HTTP response; no explicit payload return for callers.
- Side effects/gotchas:
  - best-effort Redis metrics and quarantine writes.
  - `STUB_ENABLED = false` gate for degraded website health notification path.

### `modules/routing/stream-route.js`
- `buildEpisodeShareKey(episodeId)`: computes per-episode Redis share key.
- `parseEpisodeShare(raw)`: parses/validates share JSON blob.
- `normalizeAllowedIps(raw = [])`: deduplicates and caps allowed IPs.
- `remainingShareTtlSec(state = {}, nowMs)`: computes remaining TTL for share entry.
- `getLatestSelection(clientId)`: reads latest in-memory selected episode with TTL pruning.
- `pruneLatestSelections(now = Date.now())`: prunes stale selection map entries.
- `isCurrentEpisodeSelection(clientId, episodeId)`: checks stale-vs-current episode ownership.
- `markLatestSelection(clientId, episodeId)`: updates latest selection map/version.
- `resolveEpisodeResolver(injected = {})`: resolves episode resolver dependency (injected or D client).
- `resolveForwardUserAgent(injected = {})`: resolves UA forward dependency.
- `resolveStreamIntent(ip, episodeId, injected = {})`: core resolve path (share hit/join, dedup lock/wait, D resolve, URL validation, marker writes, session view).
- `resolveLatestStreamIntent(ip, episodeId, injected = {})`: loops through stale selections until current result is produced.
- `handleStreamRequest(input = {}, injected = {})`: stream route handler that returns `{ handled, outcome }` and writes success/degraded response.
- Inner helpers:
  - `writeSessionView(state = {})`: local session-view write wrapper.
  - `trackStreamEvent(fields = [])`: best-effort hourly analytics increment.
- Return shape:
  - success: `{ handled: true, outcome: { source, cause: "success", result: "success" } }`
  - degraded/error: `{ handled: true, outcome: { source, cause, result: "degraded" } }`
  - non-stream route: `{ handled: false }`

### `modules/routing/stream-dedup.js`
- `toKeyPart(value)`: safe key-part encoding.
- `buildInFlightKeys(episodeId, ip)`: returns `{ lockKey, resultKey }`.
- `createSuccessMarker(input = {})`: success marker payload.
- `createDegradedMarker(input = {})`: degraded marker payload.
- `createStaleMarker()`: stale marker payload.
- `parseInFlightResult(raw)`: validates parsed marker shape.
- `acquireInFlightLock(input = {})`: lock acquisition via `SET NX EX`; clears prior result on acquire.
- `writeInFlightResult(input = {})`: writes marker to result key with TTL.
- `releaseInFlightLock(input = {})`: deletes lock key.
- `waitForInFlightResult(input = {})`: polls result key until marker exists or timeout.
- Return shape: marker helpers return POJOs; lock/wait functions return status objects/marker/null.

### `modules/routing/request-controls.js`
- `resolveRedisCommand(injected = {})`: finds injected or created Redis command function.
- `resolveRedisEval(injected = {}, redisCommand)`: finds injected eval or wraps command into `EVAL` call.
- `previousDay(dateStr = "")`: returns prior UTC day string.
- `applyRequestControls(input = {}, injected = {})`: enforces shutdown window, midnight reset, and atomic session gate; emits telemetry and hourly policy analytics.
- Inner helpers:
  - `trackPolicyEvent(fields = [], uniqueId = "")`: best-effort policy analytics writer.
  - `runNightlyMaintenance()`: best-effort nightly rollup trigger.
- Return shape: `{ allowed: true, ip }` or `{ allowed: false, reason }`.

### `modules/routing/operator-routes.js`
- `isValidDay(day)`: validates `YYYY-MM-DD` date correctness.
- `parsePendingDay(req)`: parses and validates `day` query param.
- `parseEventEntry(raw)`: safe JSON parse for quarantine event rows.
- `eventMatchesDay(event, day)`: filters events by day prefix.
- `parseHourlySnapshot(raw = [], bucket = "")`: reconstructs current-hour analytics projection.
- `isOperatorRoute(pathname = "")`: route matcher for operator/admin paths.
- `handleOperatorRoute(input = {}, injected = {})`: operator route dispatcher for health details, metrics, analytics, nightly rollup, pending logs, and quarantine HTML.
- Return shape: `{ handled: false }` or `{ handled: true, outcome: { source, cause, result } }`.
- Side effects/gotchas:
  - requires operator auth token via `authorizeOperator`.
  - pending log delete path iterates rows and uses `LREM` per matching entry.

### `modules/integrations/d-client.js`
- `parsePositiveInteger(value, fallback)`: positive integer parser.
- `createError(message, code, statusCode)`: typed error factory.
- `validateResolveResponse(payload)`: enforces D response shape and HTTPS URL.
- `createDClient(options = {})`: builds D integration client.
- Client methods:
  - `resolveEpisode(episodeId)`: POST `/api/resolve` with bounded dependency retries/time budget and response validation.
  - `forwardUserAgent(userAgent, episodeId, { onFailure } = {})`: fire-and-forget POST `/api/ua`.
- Return shape: client object `{ resolveEpisode, forwardUserAgent }`.
- Side effects/gotchas: normalizes return to `{ url, title }` where `title` derives from D `filename` field.

### `modules/integrations/redis-client.js`
- `getRedisConfig(options = {})`: resolves Upstash URL/token from options or env.
- `createRedisClient(options = {})`: creates bounded Redis REST client wrapper.
- Inner helpers:
  - `getCurrentConfig()`: dynamic config getter.
  - `getFetchImpl()`: injected/default fetch selector.
  - `command(parts)`: executes `/pipeline` Redis command.
  - `evalScript(script, keys = [], args = [])`: wraps Lua eval command.
- Return shape: `{ command, eval, getConfig }`.
- Side effects/gotchas: throws `redis_config_missing` when env missing.

### `modules/integrations/bounded-dependency.js`
- `sleep(ms)`: async delay helper.
- `randomJitter(maxMs)`: jitter value helper.
- `isTransientDependencyFailure(error)`: retryability classifier.
- `executeBoundedDependency(operation, options = {})`: bounded two-attempt dependency executor with jitter and total timeout.
- Return shape: operation result or thrown error (`dependency_timeout` when total budget exhausted).

### `modules/analytics/hourly-tracker.js`
- `toHourBucket(input = {})`: computes `YYYY-MM-DD-HH` bucket.
- `hourlyKey(_bucket, options = {})`: hourly hash key resolver.
- `normalizeFields(fields = [])`: field sanitization/cap utility.
- `buildUniqueHllKey(bucket, field, options = {})`: HyperLogLog unique key builder.
- `trackHourlyEvent(redisCommand, input = {}, options = {})`: increments count/first_seen/last_seen fields and optional HLL unique sets.
- Return shape: tracking metadata `{ key, bucket, tracked, uniqueTracked? }`.

### `modules/analytics/nightly-rollup.js`
- `normalizeDay(day)`: strict day validation.
- `parseHashReply(raw)`: converts Redis hash array/object response to object map.
- `buildHourlyKey(_day, _hour, options = {})`: hourly key resolver.
- `isHourBucket(bucket = "")`: hour bucket validator.
- `parseHourlyFields(raw = [])`: parses hourly hash into nested bucket/event metrics.
- `listFieldsForDay(raw = [], day = "")`: collects all hourly fields for a day.
- `parseJson(raw)`: safe JSON parse helper.
- `cleanupRolledFields(redisCommand, hourlyKeyName, fields = [])`: HDEL cleanup for rolled fields.
- `runNightlyRollup(redisCommand, input = {}, options = {})`: lock-protected rollup to daily summary, metadata staging/recovery, cleanup, and completion markers.
- Return shape: `{ status, reason?, day, bucketsProcessed?, uniqueEstimateTotal? }`.

### `modules/analytics/session-view.js`
- `normalizeText(value)`: string normalizer.
- `buildSessionIdentity(ip, userAgent)`: stable session hash ID.
- `buildSessionViewKey(sessionId, options = {})`: per-session key builder.
- `upsertSessionView(redisCommand, input = {}, options = {})`: writes session snapshot and maintains active index.
- `readActiveSessionCount(redisCommand, options = {})`: prunes stale index entries and returns current count.
- Return shape: upsert metadata `{ sessionId, sessionKey, activeIndexKey, payload }` or count number.

### `modules/analytics/daily-summary-store.js`
- `normalizeDay(day)`: strict day validation.
- `resolveSummaryKey(options = {})`: summary hash key resolver.
- `isMetaField(fieldName)`: metadata field detector.
- `writeDailySummary(redisCommand, day, summary = {}, options = {})`: writes/updates day payload + last_updated meta.
- `readDailySummary(redisCommand, day, options = {})`: reads and parses day payload.
- `deleteDailySummaryEntry(redisCommand, day, options = {})`: deletes day entry.
- `listDailySummaryDays(redisCommand, options = {})`: lists sorted non-meta day fields.

### `modules/policy/time-window.js`
- `createBeirutClock(options = {})`: clock factory with timezone-aware config.
- `getBeirutInfo(clock = createBeirutClock())`: extracts localized date/time parts.
- `isWithinShutdownWindow(info, options = {})`: evaluates start/end hour window (including wrapped windows).

### `modules/policy/session-gate.js`
- `runAtomicSessionGate(input)`: executes Lua gate script for admit/rotate/block session decisions.
- Also exports `SESSION_GATE_SCRIPT` as Redis Lua contract.
- Return shape: `{ allowed, reason, rotatedIp, activeCount }`.

### `modules/policy/operator-auth.js`
- `secureEquals(left, right)`: constant-time token compare.
- `extractOperatorToken(headers = {})`: reads bearer or `x-operator-token` value.
- `authorizeOperator(input = {})`: auth decision engine.
- Return shape: `{ allowed: true }` or `{ allowed: false, statusCode, error }`.

### `modules/presentation/public-pages.js`
- `renderLandingPage()`: renders static landing/install/status HTML.
- `projectPublicHealth()`: returns public health JSON `{ status: "OK" }`.

### `modules/presentation/stream-payloads.js`
- `formatStream(title, url)`: creates canonical Stremio stream object.
- `resolveFailureClassification(causeInput, injected)`: maps error/reason to `{ source, cause }`.
- `buildDegradedStreamPayload(causeInput, injected = {})`: builds empty/fallback degraded payload.
- `applyWebsiteHealthNotificationStub(basePayload, classification, injected = {})`: optional stub payload augmentation.
- `sendDegradedStream(req, res, causeInput, injected = {})`: emits degraded telemetry and sends degraded JSON.

### `modules/presentation/operator-diagnostics.js`
- `projectHealthDiagnostics(input = {})`: delegates operator health projection.
- `projectMetricsDiagnostics(input = {})`: delegates operator metrics projection.

### `modules/presentation/quarantine-page.js`
- `redactIp(ip)`: masks IP in rendered HTML.
- `sanitizeInternalError()`: canonical safe error label.
- `renderQuarantinePage(input = {})`: builds operator quarantine HTML table.

### `observability/context.js`
- `normalizeCorrelationId(value)`: trims/normalizes correlation IDs.
- `extractCorrelationId(req)`: retrieves inbound ID or generates UUID fallback.
- `withRequestContext(req, run)`: AsyncLocalStorage request scope wrapper.
- `getRequestContext()`: returns current ALS store.
- `getCorrelationId()`: returns active correlation ID.
- `bindResponseCorrelationId(res)`: writes `X-Correlation-Id` header when available.

### `observability/logger.js`
- `createFallbackLogger(bindings = {})`: JSON console logger fallback with child context support.
- `createBaseLogger()`: builds pino logger with redaction or fallback logger.
- `getBaseLogger()`: memoized base logger accessor.
- `getLogger(bindings = {})`: child logger enriched with correlation ID.
- `setBaseLoggerForTest(logger)`: test logger injection.
- `resetBaseLoggerForTest()`: resets memoized logger for tests.

### `observability/events.js`
- `normalizeSource(sourceValue, causeValue)`: source normalization heuristic.
- `classifyFailure(input = {})`: canonical failure classification.
- `buildEvent(eventName, payload = {})`: constructs event envelope with category/source/correlation.
- `emitEvent(logger, eventName, payload = {})`: writes structured event if logger is available.
- Also exports constant enums: `SOURCES`, `CATEGORIES`, `EVENTS`.

### `observability/metrics.js`
- `normalizeBoundedValue(dimension, value)`: bounded enum normalization and heuristic mapping.
- `normalizeLabels(labels = {})`: canonical reliability label normalization.
- `encodeField(labels)`: converts labels to hash key field string.
- `decodeField(field)`: parses field string back to normalized labels.
- `parseHashResponse(hashResponse)`: supports array/object Redis hash responses.
- `incrementReliabilityCounter(redisCommand, labels = {}, amount = 1)`: writes counters + metadata timestamps.
- `readReliabilitySummary(redisCommand)`: aggregates totals and dimensions for operator use.

### `observability/diagnostics.js`
- `sanitizeCountMap(input = {})`: non-negative numeric map normalization.
- `sanitizeMetricSeries(metrics = [])`: bounded/filtered metrics projection.
- `projectReliabilityPayload(reliability = {})`: operator-safe reliability payload.
- `projectOperatorHealth(input = {})`: health diagnostics payload.
- `projectOperatorMetrics(input = {})`: metrics diagnostics payload.

### `modules/index.js`
- No runtime functions; this is a maintainer import/boundary map file.

## Templates

Template -> path -> implementing A file(s)

- Helix Website Design -> `.planning/templates/HELIX-WEBSITE-DESIGN-TEMPLATE.md` -> `modules/presentation/public-pages.js`, `modules/presentation/quarantine-page.js`
- Helix Check Button -> `.planning/templates/HELIX-CHECK-BUTTON-TEMPLATE.md` -> `modules/routing/operator-routes.js` (`/operator/rollup/nightly` and operator endpoints)
- Helix Hourly Records -> `.planning/templates/HELIX-HOURLY-RECORDS-TEMPLATE.md` -> `modules/analytics/hourly-tracker.js`, `modules/analytics/nightly-rollup.js`
- Helix API Contracts -> `.planning/templates/HELIX-API-CONTRACTS-TEMPLATE.md` -> `modules/integrations/d-client.js`, `modules/routing/stream-route.js`
- Helix Error Logging -> `.planning/templates/HELIX-ERROR-LOGGING-TEMPLATE.md` -> `observability/logger.js`, `observability/events.js`
- Helix Health Check -> `.planning/templates/HELIX-HEALTH-CHECK-TEMPLATE.md` -> `modules/presentation/public-pages.js`, `modules/routing/operator-routes.js` (`/health/details`)
- Section API Docs -> `.planning/templates/sections/SECTION-API-DOCS.md` -> `modules/routing/http-handler.js` route map and operator/public endpoint surfaces
- Section Connections -> `.planning/templates/sections/SECTION-CONNECTIONS.md` -> `modules/integrations/d-client.js`, `modules/integrations/redis-client.js`
- Section Endpoints -> `.planning/templates/sections/SECTION-ENDPOINTS.md` -> `modules/routing/http-handler.js`, `modules/routing/operator-routes.js`
- Section Health Checks -> `.planning/templates/sections/SECTION-HEALTH-CHECKS.md` -> `modules/presentation/public-pages.js`, `modules/routing/operator-routes.js`
- Section Health Notification -> `.planning/templates/sections/SECTION-HEALTH-NOTIFICATION.md` -> `modules/presentation/stream-payloads.js` (stub-gated path)
- Section Landing Page -> `.planning/templates/sections/SECTION-LANDING-PAGE.md` -> `modules/presentation/public-pages.js`
- Section Status Page Card Header -> `.planning/templates/sections/SECTION-STATUS-PAGE-CARD-HEADER.md` -> `modules/presentation/public-pages.js`, `modules/presentation/quarantine-page.js`
- STUB-D-01 Contract -> `.planning/templates/stubs/STUB-D-01.md` -> `modules/routing/http-handler.js`, `modules/presentation/stream-payloads.js`

## Future Ideas Placement

- Hourly Records activation (A scope)
  - Insertion point: `modules/analytics/hourly-tracker.js` (`trackHourlyEvent(redisCommand, input, options)`)
  - Connection wiring: called from `modules/routing/request-controls.js` (`trackPolicyEvent`) and `modules/routing/stream-route.js` (`trackStreamEvent`)
  - Reads/Writes/Calls: writes Redis hash/HLL analytics keys via `redisCommand`

- Shared DB extension for cross-server records
  - Insertion point: `modules/integrations/redis-client.js` (`createRedisClient(options)`) and `modules/analytics/daily-summary-store.js`
  - Connection wiring: replace or extend Redis backend adapter while preserving `redisCommand` interface consumed by routing/analytics
  - Reads/Writes/Calls: centralized key lifecycle for hourly + daily summary projections

- Partial sync mechanism documentation hooks
  - Insertion point: `modules/index.js` (maintainer module map) and `add-jipi/docs/CODEBASE.md` template map section
  - Connection wiring: sync automation should treat listed template-implemented files as A propagation targets
  - Reads/Writes/Calls: reads template map and repo coverage matrix; no runtime changes required

- Per-server future docs continuation
  - Insertion point: `add-jipi/docs/CODEBASE.md` (`## Runtime Files and Function Inventory` + `## Future Ideas Placement`)
  - Connection wiring: future plan tasks should append implementation notes under exact file/function entries above

- STUB-D-01: website health notification
  - Location: `modules/routing/http-handler.js` and `modules/presentation/stream-payloads.js`
  - Canonical contract: `.planning/templates/stubs/STUB-D-01.md`
