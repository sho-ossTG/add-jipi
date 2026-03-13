const { getRouter } = require("stremio-addon-sdk");
const proxyaddr = require("proxy-addr");
const { createRedisClient } = require("../integrations/redis-client");
const { applyRequestControls } = require("./request-controls");
const { handleStreamRequest } = require("./stream-route");
const { handleOperatorRoute } = require("./operator-routes");
const { sendDegradedStream } = require("../presentation/stream-payloads");
const {
  renderLandingPage,
  projectPublicHealth
} = require("../presentation/public-pages");
const {
  withRequestContext,
  bindResponseCorrelationId,
  getCorrelationId
} = require("../../observability/context");
const { getLogger } = require("../../observability/logger");
const {
  EVENTS,
  emitEvent,
  classifyFailure
} = require("../../observability/events");
const {
  incrementReliabilityCounter,
  readReliabilitySummary
} = require("../../observability/metrics");
const { trackHourlyEvent, toHourBucket } = require("../analytics/hourly-tracker");
const { runNightlyRollup } = require("../analytics/nightly-rollup");

function parsePositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  const parsed = Number.parseInt(String(raw || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

const SLOT_TTL = parsePositiveIntEnv("SLOT_TTL_SEC", 3600);
const INACTIVITY_LIMIT = parsePositiveIntEnv("INACTIVITY_LIMIT_SEC", 20 * 60);
const MAX_SESSIONS = parsePositiveIntEnv("MAX_SESSIONS", 2);
const RECONNECT_GRACE_MS = parsePositiveIntEnv("RECONNECT_GRACE_MS", 15000);
const ROTATION_IDLE_MS = parsePositiveIntEnv("ROTATION_IDLE_MS", 45000);
const SESSION_VIEW_TTL_SEC = parsePositiveIntEnv("SESSION_VIEW_TTL_SEC", 20 * 60);
const HOURLY_ANALYTICS_TTL_SEC = parsePositiveIntEnv("HOURLY_ANALYTICS_TTL_SEC", 36 * 3600);
const TEST_VIDEO_URL = "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_1MB.mp4";

const DEFAULT_TRUST_PROXY = "loopback,linklocal,uniquelocal";
const DEFAULT_CORS_HEADERS = "Content-Type,Authorization,X-Operator-Token";
const DEFAULT_CORS_METHODS = "GET,OPTIONS";

const DEGRADED_STREAM_POLICY = Object.freeze({
  capacity_busy: {
    mode: "fallback",
    message: "Temporary load. Try again in a few minutes."
  },
  policy_shutdown: {
    mode: "fallback",
    message: "Temporary load. Try again in a few minutes."
  },
  dependency_timeout: {
    mode: "fallback",
    message: "Stream source is temporarily delayed. Please retry shortly."
  },
  dependency_unavailable: {
    mode: "fallback",
    message: "Stream source is temporarily unavailable. Please retry shortly."
  }
});

function emitTelemetry(eventName, payload = {}) {
  return emitEvent(getLogger({ component: "serverless" }), eventName, payload);
}

const redisClient = createRedisClient();

async function redisCommand(command) {
  const operation = String(command && command[0] ? command[0] : "unknown");

  emitTelemetry(EVENTS.DEPENDENCY_ATTEMPT, {
    source: "redis",
    cause: "redis_command",
    dependency: "redis",
    operation
  });

  try {
    return await redisClient.command(command);
  } catch (error) {
    const errorDetail = String((error && error.message) || error || "unknown error");
    emitTelemetry(EVENTS.DEPENDENCY_FAILURE, {
      ...classifyFailure({ error, source: "redis" }),
      dependency: "redis",
      operation,
      message: `Server A could not complete Redis operation ${operation} because Redis returned an error: ${errorDetail}`
    });
    throw error;
  }
}

async function redisEval(script, keys = [], args = []) {
  return redisClient.eval(script, keys, args);
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getTrustedProxy() {
  const trustValue = process.env.TRUST_PROXY || DEFAULT_TRUST_PROXY;
  const trustList = parseCsv(trustValue);
  return proxyaddr.compile(trustList.length ? trustList : ["loopback"]);
}

function getTrustedClientIp(req) {
  try {
    const proxyReq = req.connection ? req : { ...req, connection: req.socket };
    const trusted = proxyaddr(proxyReq, getTrustedProxy());
    return trusted || "unknown";
  } catch {
    return (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || "unknown";
  }
}

function isStremioRoute(pathname) {
  return pathname === "/manifest.json" || pathname.startsWith("/catalog/") || pathname.startsWith("/stream/");
}

function isGatedStreamRoute(pathname) {
  return pathname.startsWith("/stream/");
}

function parseStreamEpisodeId(pathname) {
  const match = String(pathname || "").match(/^\/stream\/series\/([^/]+)\.json$/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

function isBlockedStreamCause(cause) {
  return cause === "policy_shutdown" || cause === "capacity_busy";
}

function normalizeStreamSummaryMode(cause) {
  if (cause === "policy_shutdown") return "shutdown";
  if (cause === "capacity_busy") return "capacity_busy";
  return "streaming";
}

function normalizeStreamSummaryOutcome(result, cause) {
  if (isBlockedStreamCause(cause)) return "blocked";
  if (result === "degraded") return "degraded";
  return "success";
}

function classifyRoute(pathname) {
  if (
    pathname === "/quarantine" ||
    pathname === "/health/details" ||
    pathname.startsWith("/operator/") ||
    pathname.startsWith("/admin/")
  ) {
    return "operator";
  }
  if (isStremioRoute(pathname)) {
    return "stremio";
  }
  return "public";
}

function getCorsPolicy() {
  const origins = new Set(parseCsv(process.env.CORS_ALLOW_ORIGINS));
  const headers = parseCsv(process.env.CORS_ALLOW_HEADERS || DEFAULT_CORS_HEADERS).map((item) => item.toLowerCase());
  const methods = parseCsv(process.env.CORS_ALLOW_METHODS || DEFAULT_CORS_METHODS);

  return {
    origins,
    headers,
    methods
  };
}

function applyCors(req, res) {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (!origin) {
    return { hasOrigin: false, originAllowed: false };
  }

  const policy = getCorsPolicy();
  if (!policy.origins.has(origin)) {
    return { hasOrigin: true, originAllowed: false };
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  const vary = String(res.getHeader ? res.getHeader("Vary") || "" : "");
  const varyEntries = parseCsv(vary).map((item) => item.toLowerCase());
  if (!varyEntries.includes("origin")) {
    const nextVary = vary ? `${vary}, Origin` : "Origin";
    res.setHeader("Vary", nextVary);
  }
  return { hasOrigin: true, originAllowed: true, policy };
}

function sendJson(req, res, statusCode, payload) {
  applyCors(req, res);
  bindResponseCorrelationId(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function handlePreflight(req, res) {
  if (req.method !== "OPTIONS") return false;

  const cors = applyCors(req, res);
  if (!cors.originAllowed) {
    res.statusCode = 204;
    res.end();
    return true;
  }

  const requestedMethod = String(req.headers["access-control-request-method"] || "").trim().toUpperCase();
  if (requestedMethod && !cors.policy.methods.includes(requestedMethod)) {
    res.statusCode = 403;
    sendJson(req, res, 403, { error: "cors_method_not_allowed" });
    return true;
  }

  const requestedHeaders = parseCsv(req.headers["access-control-request-headers"]).map((item) => item.toLowerCase());
  const invalidHeader = requestedHeaders.find((header) => !cors.policy.headers.includes(header));
  if (invalidHeader) {
    res.statusCode = 403;
    sendJson(req, res, 403, { error: "cors_header_not_allowed" });
    return true;
  }

  res.setHeader("Access-Control-Allow-Methods", cors.policy.methods.join(","));
  res.setHeader("Access-Control-Allow-Headers", cors.policy.headers.join(","));
  res.statusCode = 204;
  res.end();
  return true;
}

function sendPublicError(req, res, statusCode = 503) {
  sendJson(req, res, statusCode, { error: "service_unavailable" });
}

function handlePublicRoute(req, res, pathname) {
  if (pathname === "/") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html");
    applyCors(req, res);
    bindResponseCorrelationId(res);
    res.end(renderLandingPage());
    return { handled: true, outcome: { source: "policy", cause: "success", result: "success" } };
  }

  if (pathname === "/health") {
    sendJson(req, res, 200, projectPublicHealth());
    return { handled: true, outcome: { source: "policy", cause: "success", result: "success" } };
  }

  return { handled: false };
}

function bucketToUtcHourIso(bucketInput) {
  const bucket = String(bucketInput || "").trim();
  const [year, month, day, hour] = bucket.split("-");
  if (!year || !month || !day || !hour) {
    return new Date().toISOString().slice(0, 13) + ":00:00Z";
  }
  return `${year}-${month}-${day}T${hour}:00:00Z`;
}

function toCount(value) {
  const parsed = Number.parseInt(String(value == null ? "0" : value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

async function handleStatsRoute(req, res, pathname) {
  if (pathname !== "/api/stats") {
    return { handled: false };
  }

  const method = String((req && req.method) || "GET").toUpperCase();
  if (method !== "GET") {
    sendJson(req, res, 405, { error: "method_not_allowed" });
    return {
      handled: true,
      outcome: { source: "policy", cause: "method_not_allowed", result: "failure" }
    };
  }

  const bucket = toHourBucket();
  const hour = bucketToUtcHourIso(bucket);

  try {
    const [requestRaw, errorRaw] = await Promise.all([
      redisCommand(["HGET", "analytics:hourly", `${bucket}|requests.total|count`]),
      redisCommand(["HGET", "analytics:hourly", `${bucket}|policy.blocked|count`])
    ]);

    sendJson(req, res, 200, {
      server: "A",
      hour,
      request_count: toCount(requestRaw),
      error_count: toCount(errorRaw)
    });

    return {
      handled: true,
      outcome: { source: "redis", cause: "success", result: "success" }
    };
  } catch {
    sendJson(req, res, 503, { error: "dependency_unavailable" });
    return {
      handled: true,
      outcome: { source: "redis", cause: "dependency_unavailable", result: "failure" }
    };
  }
}

function classifyReliabilityCause(errorOrReason) {
  const classification = typeof errorOrReason === "string"
    ? classifyFailure({ reason: errorOrReason })
    : classifyFailure({ error: errorOrReason });

  if (classification.cause === "policy_shutdown") return "policy_shutdown";
  if (classification.cause === "capacity_busy") return "capacity_busy";
  if (classification.cause === "dependency_timeout") return "dependency_timeout";
  return "dependency_unavailable";
}

function normalizeReliabilityResult(statusCode, fallbackResult = "success") {
  const numericStatus = Number(statusCode || 0);
  if (numericStatus >= 500) return "failure";
  if (numericStatus >= 400) return "failure";
  return fallbackResult;
}

function normalizeReliabilitySource(source, cause) {
  return classifyFailure({ source, cause }).source;
}

async function recordReliabilityOutcome(routeClass, payload = {}) {
  const labels = {
    source: normalizeReliabilitySource(payload.source || "policy", payload.cause),
    cause: payload.cause || "success",
    routeClass,
    result: payload.result || "success"
  };

  try {
    await incrementReliabilityCounter(redisCommand, labels);
  } catch {
    // Reliability counters are best-effort and must not affect responses.
  }
}

const requestControlDependencies = Object.freeze({
  isStremioRoute: isGatedStreamRoute,
  getTrustedClientIp,
  redisCommand,
  redisEval,
  emitTelemetry,
  classifyFailure,
  events: EVENTS,
  slotTtlSec: SLOT_TTL,
  inactivityLimitSec: INACTIVITY_LIMIT,
  maxSessions: MAX_SESSIONS,
  reconnectGraceMs: RECONNECT_GRACE_MS,
  rotationIdleMs: ROTATION_IDLE_MS,
  hourlyAnalyticsTtlSec: HOURLY_ANALYTICS_TTL_SEC,
  trackHourlyEvent,
  runNightlyRollup
});

function getAddonInterface() {
  return require("../../addon");
}

function buildStreamRouteDependencies() {
  return {
    redisCommand,
    resolveEpisode: (...args) => getAddonInterface().resolveEpisode(...args),
    sendJson,
    sendDegradedStream,
    emitTelemetry,
    classifyFailure,
    events: EVENTS,
    degradedPolicy: DEGRADED_STREAM_POLICY,
    fallbackVideoUrl: TEST_VIDEO_URL,
    sessionViewTtlSec: SESSION_VIEW_TTL_SEC,
    inactivityLimitSec: INACTIVITY_LIMIT,
    hourlyAnalyticsTtlSec: HOURLY_ANALYTICS_TTL_SEC,
    trackHourlyEvent
  };
}

async function createHttpHandler(req, res) {
  return withRequestContext(req, async () => {
    const runtimeRouter = getRouter(getAddonInterface());
    const streamRouteDependencies = buildStreamRouteDependencies();

    bindResponseCorrelationId(res);
    const startedAt = Date.now();
    const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = reqUrl.pathname;
    const routeType = classifyRoute(pathname);
    const streamEpisodeId = parseStreamEpisodeId(pathname);
    const streamUserAgent = String(req.headers["user-agent"] || "");
    let reliabilityOutcome = null;

    function setReliabilityOutcome(outcome = {}) {
      reliabilityOutcome = {
        source: outcome.source || (reliabilityOutcome && reliabilityOutcome.source) || "policy",
        cause: outcome.cause || (reliabilityOutcome && reliabilityOutcome.cause) || "success",
        result: outcome.result || (reliabilityOutcome && reliabilityOutcome.result) || "success"
      };
    }

    const STUB_ENABLED = false;

    function sendStubAwareDegradedStream(causeInput) {
      sendDegradedStream(req, res, causeInput, {
        ...streamRouteDependencies,
        stubs: {
          websiteHealthNotification: {
            enabled: STUB_ENABLED,
            route: pathname,
            statusPath: "/health"
          }
        }
      });
    }

    emitTelemetry(EVENTS.REQUEST_START, {
      source: "policy",
      cause: "received",
      route: pathname,
      method: req.method || "GET",
      routeType
    });

    try {
      if (handlePreflight(req, res)) {
        return;
      }

      const operatorResult = await handleOperatorRoute(
        { req, res, pathname },
        {
          sendJson,
          redisCommand,
          readReliabilitySummary,
          applyCors,
          maxSessions: MAX_SESSIONS,
          sessionViewTtlSec: SESSION_VIEW_TTL_SEC,
          expectedToken: process.env.OPERATOR_TOKEN || "",
          emitTelemetry,
          classifyFailure,
          events: EVENTS
        }
      );
      if (operatorResult.handled) {
        setReliabilityOutcome(operatorResult.outcome || {});
        return;
      }

      const publicResult = handlePublicRoute(req, res, pathname);
      if (publicResult.handled) {
        setReliabilityOutcome(publicResult.outcome || {});
        return;
      }

      const statsResult = await handleStatsRoute(req, res, pathname);
      if (statsResult.handled) {
        setReliabilityOutcome(statsResult.outcome || {});
        return;
      }

      try {
        const controlResult = await applyRequestControls(
          { req, pathname },
          requestControlDependencies
        );

          if (!controlResult.allowed) {
            const deniedCause = classifyReliabilityCause(controlResult.reason || "blocked:slot_taken");
            if (pathname.startsWith("/stream/")) {
              setReliabilityOutcome({ source: "policy", cause: deniedCause, result: "degraded" });
              sendStubAwareDegradedStream(controlResult.reason);
              return;
            }
            setReliabilityOutcome({ source: "policy", cause: deniedCause, result: "failure" });
            sendPublicError(req, res, 503);
            return;
        }

        if (pathname.startsWith("/stream/")) {
          const streamResult = await handleStreamRequest(
            {
              req,
              res,
              pathname,
              ip: controlResult.ip || getTrustedClientIp(req)
            },
            {
              ...streamRouteDependencies,
              onStreamError: async ({ error, ip, episodeId }) => {
                try {
                  await redisCommand(["INCR", "stats:d_error"]);
                } catch {
                  // Best-effort metric path.
                }

                const event = {
                  ip,
                  error: error.message,
                  episodeId,
                  time: new Date().toISOString()
                };

                try {
                  await redisCommand(["LPUSH", "quarantine:events", JSON.stringify(event)]);
                  await redisCommand(["LTRIM", "quarantine:events", "0", "49"]);
                } catch {
                  // Best-effort quarantine path.
                }
              },
              onUaForwardError: async () => {
                try {
                  await redisCommand(["INCR", "stats:ua_forward_error"]);
                } catch {
                  // Best-effort metric path.
                }
              }
            }
          );
          if (streamResult && streamResult.handled) {
            setReliabilityOutcome(streamResult.outcome || {});
            return;
          }
        }
      } catch (error) {
        const failure = classifyFailure({ error });
        if (pathname.startsWith("/stream/")) {
          setReliabilityOutcome({ source: failure.source, cause: failure.cause, result: "degraded" });
          sendStubAwareDegradedStream(error);
          return;
        }
        setReliabilityOutcome({ source: failure.source, cause: failure.cause, result: "failure" });
        sendPublicError(req, res, 503);
        return;
      }

      applyCors(req, res);
      bindResponseCorrelationId(res);
      runtimeRouter(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
      setReliabilityOutcome({
        source: "policy",
        cause: "service_unavailable",
        result: normalizeReliabilityResult(res.statusCode, "success")
      });
    } finally {
      const fallbackResult = normalizeReliabilityResult(res.statusCode, "success");
      await recordReliabilityOutcome(routeType, {
        source: reliabilityOutcome && reliabilityOutcome.source,
        cause: reliabilityOutcome && reliabilityOutcome.cause,
        result: (reliabilityOutcome && reliabilityOutcome.result) || fallbackResult
      });

      emitTelemetry(EVENTS.REQUEST_COMPLETE, {
        source: "policy",
        cause: "completed",
        route: pathname,
        method: req.method || "GET",
        routeType,
        statusCode: Number(res.statusCode || 0),
        durationMs: Date.now() - startedAt,
        correlationId: getCorrelationId()
      });

      if (isGatedStreamRoute(pathname)) {
        const cause = reliabilityOutcome && reliabilityOutcome.cause ? reliabilityOutcome.cause : "success";
        const result = reliabilityOutcome && reliabilityOutcome.result ? reliabilityOutcome.result : fallbackResult;
        const outcome = normalizeStreamSummaryOutcome(result, cause);

        getLogger({ component: "serverless" }).info({
          event: "stream.request_end",
          episode_id: streamEpisodeId,
          outcome,
          mode: normalizeStreamSummaryMode(cause),
          duration_ms: Date.now() - startedAt,
          error: outcome === "success" ? null : cause,
          userAgent: streamUserAgent,
          ip: getTrustedClientIp(req),
          cache: null,
          worker: null
        });
      }
    }
  });
}

module.exports = {
  createHttpHandler
};
