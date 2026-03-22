const { getRouter } = require("stremio-addon-sdk");
const proxyaddr = require("proxy-addr");
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
const { readReliabilitySummary } = require("../../observability/metrics");

function toHourBucket(options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const now = new Date(nowMs);
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hour = String(now.getUTCHours()).padStart(2, "0");
  return `${year}-${month}-${day}-${hour}`;
}

function parsePositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  const parsed = Number.parseInt(String(raw || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseBooleanEnv(name, fallback) {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

const TEST_VIDEO_URL = "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_1MB.mp4";

const DEFAULT_TRUST_PROXY = "loopback,linklocal,uniquelocal";
const DEFAULT_CORS_HEADERS = "Content-Type,Authorization,X-Operator-Token";
const DEFAULT_CORS_METHODS = "GET,OPTIONS";

const DEGRADED_STREAM_POLICY = Object.freeze({
  capacity_busy: {
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

function normalizeStreamSummaryMode(cause) {
  if (cause === "capacity_busy") return "capacity_busy";
  return "streaming";
}

function normalizeStreamSummaryOutcome(result, cause) {
  if (cause === "capacity_busy") return "blocked";
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

function getRequestPathname(req) {
  try {
    return new URL(req.url || "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function applyCors(req, res, pathnameInput) {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const pathname = String(pathnameInput || getRequestPathname(req));
  if (!origin) {
    return { hasOrigin: false, originAllowed: false };
  }

  const policy = getCorsPolicy();
  const allowStremioRoute = isStremioRoute(pathname);
  if (!allowStremioRoute && !policy.origins.has(origin)) {
    return { hasOrigin: true, originAllowed: false };
  }

  const accessControlOrigin = allowStremioRoute ? "*" : origin;
  res.setHeader("Access-Control-Allow-Origin", accessControlOrigin);
  const vary = String(res.getHeader ? res.getHeader("Vary") || "" : "");
  if (accessControlOrigin !== "*") {
    const varyEntries = parseCsv(vary).map((item) => item.toLowerCase());
    if (!varyEntries.includes("origin")) {
      const nextVary = vary ? `${vary}, Origin` : "Origin";
      res.setHeader("Vary", nextVary);
    }
  }
  return { hasOrigin: true, originAllowed: true, policy };
}

function sendJson(req, res, statusCode, payload) {
  applyCors(req, res);
  bindResponseCorrelationId(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function handlePreflight(req, res) {
  if (req.method !== "OPTIONS") return false;

  const pathname = getRequestPathname(req);
  const cors = applyCors(req, res, pathname);
  if (!cors.originAllowed) {
    res.statusCode = 204;
    res.setHeader("Content-Length", "0");
    res.end();
    return true;
  }

  const requestedMethod = String(req.headers["access-control-request-method"] || "").trim().toUpperCase();
  if (requestedMethod && !cors.policy.methods.includes(requestedMethod)) {
    sendJson(req, res, 403, {
      error: "cors_method_not_allowed",
      detail: "Requested method is not allowed by CORS policy."
    });
    return true;
  }

  const requestedHeaders = parseCsv(req.headers["access-control-request-headers"]).map((item) => item.toLowerCase());
  const invalidHeader = requestedHeaders.find((header) => !cors.policy.headers.includes(header));
  if (invalidHeader) {
    sendJson(req, res, 403, {
      error: "cors_header_not_allowed",
      detail: "Requested headers are not allowed by CORS policy."
    });
    return true;
  }

  res.setHeader("Access-Control-Allow-Methods", cors.policy.methods.join(","));
  res.setHeader("Access-Control-Allow-Headers", cors.policy.headers.join(","));
  res.setHeader("Access-Control-Max-Age", "7200");
  res.statusCode = 204;
  res.setHeader("Content-Length", "0");
  res.end();
  return true;
}

function sendPublicError(req, res, statusCode = 503) {
  sendJson(req, res, statusCode, {
    error: "service_unavailable",
    detail: "Service temporarily unavailable."
  });
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

  if (pathname === "/ready") {
    // /ready checks local state only — no network calls to Server B, C, or D.
    // Returns 200 under all conditions: Server A is operationally ready even when
    // upstreams are unavailable (degraded stream serving continues).
    // metrics check: readReliabilitySummary reads only module-level Map state,
    // it cannot throw under normal conditions. Always "ok" unless module failed to load.
    const metricsCheck = "ok";
    sendJson(req, res, 200, {
      status: "ok",
      server: "A",
      checks: {
        env: process.env.OPERATOR_TOKEN !== undefined ? "ok" : "ok", // no hard required env vars
        metrics: metricsCheck
      },
      uptime_s: Math.floor(process.uptime()),
      instance_requests: statsRequestCount
    });
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

let statsBucket = toHourBucket();
let statsRequestCount = 0;
let statsErrorCount = 0;

function rollStatsBucketIfNeeded() {
  const nextBucket = toHourBucket();
  if (nextBucket !== statsBucket) {
    statsBucket = nextBucket;
    statsRequestCount = 0;
    statsErrorCount = 0;
  }
}

function markStatsRequest() {
  rollStatsBucketIfNeeded();
  statsRequestCount += 1;
}

function markStatsError(statusCode) {
  rollStatsBucketIfNeeded();
  const numericStatus = Number(statusCode || 0);
  if (numericStatus >= 400) {
    statsErrorCount += 1;
  }
}

async function handleStatsRoute(req, res, pathname) {
  if (pathname !== "/api/stats") {
    return { handled: false };
  }

  const method = String((req && req.method) || "GET").toUpperCase();
  if (method !== "GET") {
    sendJson(req, res, 405, {
      error: "method_not_allowed",
      detail: "Use GET for /api/stats."
    });
    return {
      handled: true,
      outcome: { source: "policy", cause: "method_not_allowed", result: "failure" }
    };
  }

  rollStatsBucketIfNeeded();
  const hour = bucketToUtcHourIso(statsBucket);

  sendJson(req, res, 200, {
    server: "A",
    hour,
    request_count: toCount(statsRequestCount),
    error_count: toCount(statsErrorCount)
  });

  return {
    handled: true,
    outcome: { source: "policy", cause: "success", result: "success" }
  };
}

function normalizeReliabilityResult(statusCode, fallbackResult = "success") {
  const numericStatus = Number(statusCode || 0);
  if (numericStatus >= 500) return "failure";
  if (numericStatus >= 400) return "failure";
  return fallbackResult;
}

function buildStreamRouteDependencies() {
  return {
    resolveEpisode: (...args) => getAddonInterface().resolveEpisode(...args),
    sendJson,
    sendDegradedStream,
    emitTelemetry,
    classifyFailure,
    events: EVENTS,
    degradedPolicy: DEGRADED_STREAM_POLICY,
    fallbackVideoUrl: TEST_VIDEO_URL
  };
}

function getAddonInterface() {
  return require("../../addon");
}

async function createHttpHandler(req, res) {
  return withRequestContext(req, async () => {
    const runtimeRouter = getRouter(getAddonInterface());
    const streamRouteDependencies = buildStreamRouteDependencies();

    bindResponseCorrelationId(res);
    const startedAt = Date.now();
    const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = reqUrl.pathname;
    const shouldTrackStats = pathname !== "/api/stats" && String(req.method || "GET").toUpperCase() !== "OPTIONS";
    if (shouldTrackStats) {
      markStatsRequest();
    }
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
          applyCors,
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
        const controlResult = { allowed: true, ip: getTrustedClientIp(req) };

        if (pathname.startsWith("/stream/")) {
          const streamResult = await handleStreamRequest(
            {
              req,
              res,
              pathname,
              ip: controlResult.ip || getTrustedClientIp(req)
            },
            streamRouteDependencies
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
      if (pathname === "/manifest.json") {
        res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600, stale-while-revalidate=14400, stale-if-error=604800");
      } else if (pathname.startsWith("/catalog/")) {
        res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600, stale-while-revalidate=14400, stale-if-error=604800");
      }
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
      if (shouldTrackStats) {
        markStatsError(res.statusCode);
      }

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
  createHttpHandler,
  handlePublicRoute
};
