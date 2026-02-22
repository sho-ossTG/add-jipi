const { getRouter } = require("stremio-addon-sdk");
const proxyaddr = require("proxy-addr");
const addonInterface = require("./addon");
const { authorizeOperator } = require("./modules/policy/operator-auth");
const { createRedisClient } = require("./modules/integrations/redis-client");
const { applyRequestControls: applyRoutingRequestControls } = require("./modules/routing/request-controls");
const {
  withRequestContext,
  bindResponseCorrelationId,
  getCorrelationId
} = require("./observability/context");
const { getLogger } = require("./observability/logger");
const {
  EVENTS,
  emitEvent,
  classifyFailure
} = require("./observability/events");
const {
  incrementReliabilityCounter,
  readReliabilitySummary
} = require("./observability/metrics");
const {
  projectOperatorHealth,
  projectOperatorMetrics
} = require("./observability/diagnostics");

const router = getRouter(addonInterface);

// Constants
const SLOT_TTL = 3600; 
const INACTIVITY_LIMIT = 20 * 60; 
const MAX_SESSIONS = 2; 
const ACTIVE_URL_TTL = 3600 * 2; 
const RECONNECT_GRACE_MS = 15000;
const ROTATION_IDLE_MS = 45000;
const DEPENDENCY_ATTEMPT_TIMEOUT_MS = 900;
const DEPENDENCY_TOTAL_TIMEOUT_MS = 1800;
const DEPENDENCY_RETRY_JITTER_MS = 120;
const TEST_VIDEO_URL = "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_1MB.mp4";

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const NEUTRAL_ORIGIN = "https://www.google.com/";

const DEFAULT_TRUST_PROXY = "loopback,linklocal,uniquelocal";
const DEFAULT_CORS_HEADERS = "Content-Type,Authorization,X-Operator-Token";
const DEFAULT_CORS_METHODS = "GET,OPTIONS";

const inFlightStreamIntents = new Map();
const latestStreamSelectionByClient = new Map();
let latestStreamSelectionVersion = 0;

const LATEST_SELECTION_TTL_MS = 5 * 60 * 1000;

const DEGRADED_STREAM_POLICY = Object.freeze({
  capacity_busy: {
    mode: "empty",
    message: "Stream capacity is currently full. Please retry in a few minutes."
  },
  policy_shutdown: {
    mode: "empty",
    message: "Streaming is paused between 00:00 and 08:00 Jerusalem time. Please retry after 08:00."
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomJitter(maxMs) {
  return Math.floor(Math.random() * Math.max(1, maxMs));
}

function isTransientDependencyFailure(error) {
  if (!error) return false;
  const status = Number(error.statusCode || 0);
  if (status === 408 || status === 429 || status >= 500) return true;
  const code = String(error.code || "").toLowerCase();
  return code === "aborterror" || code === "etimedout" || code === "ecanceled" || code === "econnreset";
}

async function executeBoundedDependency(operation, options = {}) {
  const {
    attemptTimeoutMs = DEPENDENCY_ATTEMPT_TIMEOUT_MS,
    totalBudgetMs = DEPENDENCY_TOTAL_TIMEOUT_MS,
    jitterMs = DEPENDENCY_RETRY_JITTER_MS
  } = options;

  const startedAt = Date.now();
  let attempt = 0;
  let lastError;

  while (attempt < 2) {
    const elapsed = Date.now() - startedAt;
    const remaining = totalBudgetMs - elapsed;
    if (remaining <= 0) {
      const timeoutError = new Error("Dependency operation timed out");
      timeoutError.code = "dependency_timeout";
      throw timeoutError;
    }

    const timeout = Math.max(1, Math.min(attemptTimeoutMs, remaining));

    try {
      return await operation({ timeout });
    } catch (error) {
      lastError = error;
      const canRetry = attempt === 0 && isTransientDependencyFailure(error);
      if (!canRetry) break;

      const postAttemptElapsed = Date.now() - startedAt;
      const postAttemptRemaining = totalBudgetMs - postAttemptElapsed;
      if (postAttemptRemaining <= 1) break;

      const jitterDelay = Math.min(randomJitter(jitterMs), postAttemptRemaining - 1);
      if (jitterDelay > 0) {
        await sleep(jitterDelay);
      }
    }

    attempt += 1;
  }

  throw lastError;
}

const redisClient = createRedisClient({
  executeBoundedDependency
});

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
    emitTelemetry(EVENTS.DEPENDENCY_FAILURE, {
      ...classifyFailure({ error, source: "redis" }),
      dependency: "redis",
      operation
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

function redactIp(ip) {
  if (!ip || ip === "unknown") return "unknown";
  return "[redacted]";
}

function sanitizeInternalError(errorValue) {
  if (!errorValue) return "internal_error";
  return "internal_error";
}

function sendPublicError(req, res, statusCode = 503) {
  sendJson(req, res, statusCode, { error: "service_unavailable" });
}

function sendJson(req, res, statusCode, payload) {
  applyCors(req, res);
  bindResponseCorrelationId(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function formatStream(title, url) {
  return {
    name: "Jipi",
    title: title,
    url: url,
    behaviorHints: {
      notWebReady: true
    }
  };
}

function sendErrorStream(req, res, title) {
  sendJson(req, res, 200, {
    streams: [formatStream(`⚠️ ${title}`, TEST_VIDEO_URL)]
  });
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

function buildDegradedStreamPayload(causeInput) {
  const cause = classifyReliabilityCause(causeInput);
  const policy = DEGRADED_STREAM_POLICY[cause] || DEGRADED_STREAM_POLICY.dependency_unavailable;

  if (policy.mode === "empty") {
    return {
      streams: [],
      notice: policy.message
    };
  }

  return {
    streams: [formatStream(`⚠️ ${policy.message}`, TEST_VIDEO_URL)]
  };
}

function sendDegradedStream(req, res, causeInput) {
  const classification = typeof causeInput === "string"
    ? classifyFailure({ reason: causeInput })
    : classifyFailure({ error: causeInput });
  emitTelemetry(EVENTS.REQUEST_DEGRADED, {
    ...classification,
    route: req.url || "",
    method: req.method || "GET"
  });
  sendJson(req, res, 200, buildDegradedStreamPayload(causeInput));
}

const requestControlDependencies = Object.freeze({
  isStremioRoute,
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
  rotationIdleMs: ROTATION_IDLE_MS
});

async function resolveStreamIntent(ip, episodeId) {
  const activeUrlKey = `active:url:${ip}`;
  const lastSeenKey = `active:last_seen:${ip}`;

  const existingRaw = await redisCommand(["GET", activeUrlKey]);
  if (existingRaw) {
    try {
      const existing = JSON.parse(existingRaw);
      if (existing.episodeId === episodeId) {
        await redisCommand(["SET", lastSeenKey, String(Date.now()), "EX", String(INACTIVITY_LIMIT)]);
        return {
          status: "ok",
          title: existing.title || "Resolved via Jipi",
          url: existing.url
        };
      }
    } catch {
      // Ignore malformed cache payload and re-resolve.
    }
  }

  emitTelemetry(EVENTS.DEPENDENCY_ATTEMPT, {
    source: "broker",
    cause: "resolve_episode",
    dependency: "broker",
    episodeId
  });

  let resolved;
  try {
    resolved = await addonInterface.resolveEpisode(episodeId);
  } catch (error) {
    emitTelemetry(EVENTS.DEPENDENCY_FAILURE, {
      ...classifyFailure({ error, source: "broker" }),
      dependency: "broker",
      episodeId
    });
    throw error;
  }
  let finalUrl = resolved.url || "";

  if (finalUrl.startsWith("http://")) {
    finalUrl = finalUrl.replace("http://", "https://");
  }

  if (!finalUrl.startsWith("https://")) {
    emitTelemetry(EVENTS.DEPENDENCY_FAILURE, {
      source: "validation",
      cause: "validation_invalid_stream_url",
      dependency: "broker",
      episodeId
    });
    return {
      status: "degraded",
      cause: "validation_invalid_stream_url"
    };
  }

  const payload = {
    url: finalUrl,
    episodeId,
    title: resolved.title,
    updatedAt: Date.now()
  };

  if (!isCurrentEpisodeSelection(ip, episodeId)) {
    return {
      status: "stale"
    };
  }

  await redisCommand(["SET", activeUrlKey, JSON.stringify(payload), "EX", String(ACTIVE_URL_TTL)]);
  await redisCommand(["SET", lastSeenKey, String(Date.now()), "EX", String(INACTIVITY_LIMIT)]);

  return {
    status: "ok",
    title: resolved.title || "Resolved via Jipi",
    url: finalUrl
  };
}

function getLatestSelection(clientId) {
  const latest = latestStreamSelectionByClient.get(clientId);
  if (!latest) return null;

  if ((Date.now() - latest.updatedAt) > LATEST_SELECTION_TTL_MS) {
    latestStreamSelectionByClient.delete(clientId);
    return null;
  }

  return latest;
}

function pruneLatestSelections(now = Date.now()) {
  for (const [clientId, selection] of latestStreamSelectionByClient.entries()) {
    if ((now - selection.updatedAt) > LATEST_SELECTION_TTL_MS) {
      latestStreamSelectionByClient.delete(clientId);
    }
  }
}

function isCurrentEpisodeSelection(clientId, episodeId) {
  const latest = getLatestSelection(clientId);
  if (!latest) return true;
  return latest.episodeId === episodeId;
}

function markLatestSelection(clientId, episodeId) {
  pruneLatestSelections();
  latestStreamSelectionVersion += 1;
  const next = {
    episodeId,
    version: latestStreamSelectionVersion,
    updatedAt: Date.now()
  };
  latestStreamSelectionByClient.set(clientId, next);
  return next;
}

async function resolveLatestStreamIntent(ip, episodeId) {
  let currentEpisodeId = episodeId;

  while (true) {
    const intentKey = `${ip}:${currentEpisodeId}`;
    const result = await getOrCreateInFlightIntent(intentKey, () => resolveStreamIntent(ip, currentEpisodeId));
    const latest = getLatestSelection(ip);

    if (result.status === "stale" && latest && latest.episodeId !== currentEpisodeId) {
      currentEpisodeId = latest.episodeId;
      continue;
    }

    if (!latest || latest.episodeId === currentEpisodeId) {
      return result;
    }

    currentEpisodeId = latest.episodeId;
  }
}

function getOrCreateInFlightIntent(intentKey, producer) {
  if (inFlightStreamIntents.has(intentKey)) {
    return inFlightStreamIntents.get(intentKey);
  }

  const inFlight = Promise.resolve()
    .then(() => producer())
    .finally(() => {
      inFlightStreamIntents.delete(intentKey);
    });

  inFlightStreamIntents.set(intentKey, inFlight);
  return inFlight;
}

function getLandingPageHtml() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>One Piece (Jipi) - Stremio Addon</title>
    <style>
        body { margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), url('https://dl.strem.io/addon-background.jpg') no-repeat center center fixed; background-size: cover; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; text-align: center; }
        .container { background: rgba(0, 0, 0, 0.8); padding: 3rem; border-radius: 15px; max-width: 500px; width: 90%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); }
        h1 { margin-top: 0; margin-bottom: 1rem; font-size: 2.5rem; }
        p { margin-bottom: 2.5rem; opacity: 0.9; font-size: 1.1rem; line-height: 1.6; }
        .install-btn { display: inline-block; background-color: #8A5BB8; color: white; padding: 1.2rem 2.5rem; text-decoration: none; font-weight: bold; border-radius: 8px; margin-bottom: 1.5rem; transition: transform 0.2s, background 0.3s; font-size: 1.2rem; letter-spacing: 1px; }
        .install-btn:hover { background-color: #7a4ba8; transform: scale(1.05); }
        .manifest-link { display: block; color: #aaa; text-decoration: none; font-size: 0.9rem; transition: color 0.3s; }
        .manifest-link:hover { color: #fff; text-decoration: underline; }
        .nav-links { margin-top: 2rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1rem; }
        .nav-links a { color: #8A5BB8; text-decoration: none; margin: 0 10px; font-size: 0.8rem; }
    </style>
</head>
<body>
    <div class="container">
        <h1>One Piece (Jipi)</h1>
        <p>Streams resolved via Broker (B) and Worker (C)</p>
        <a href="stremio://add-jipi.vercel.app/manifest.json" class="install-btn">INSTALL ADDON</a>
        <a href="https://add-jipi.vercel.app/manifest.json" class="manifest-link">Manual Manifest Link</a>
        <div class="nav-links">
            <a href="/health">Health Check</a>
            <a href="/quarantine">Quarantine Logs</a>
        </div>
    </div>
    <script>
      window.si = window.si || function(){(window.si.q=window.si.q||[]).push(arguments)};
    </script>
    <script defer src="/_vercel/speed-insights/script.js"></script>
</body>
</html>
  `.trim();
}

async function handleStreamRequest(req, res, pathname, ip) {
  const match = pathname.match(/^\/stream\/([^/]+)\/([^/]+)\.json$/);
  if (!match || match[1] !== "series") return false;
  
  const episodeId = decodeURIComponent(match[2]);
  
  // Only handle One Piece
  if (!episodeId.startsWith("tt0388629")) {
    return false;
  }

  markLatestSelection(ip, episodeId);

  try {
    const result = await resolveLatestStreamIntent(ip, episodeId);

    if (result.status === "degraded") {
      const degraded = classifyFailure({ reason: result.cause || "dependency_unavailable", source: "broker" });
      sendDegradedStream(req, res, result.cause);
      return {
        handled: true,
        outcome: {
          source: degraded.source,
          cause: degraded.cause,
          result: "degraded"
        }
      };
    }

    sendJson(req, res, 200, {
      streams: [formatStream(result.title, result.url)]
    });
    return {
      handled: true,
      outcome: {
        source: "broker",
        cause: "success",
        result: "success"
      }
    };
  } catch (err) {
    try {
      await redisCommand(["INCR", "stats:broker_error"]);
    } catch {
      // Best-effort metric path.
    }

    const event = {
      ip,
      error: err.message,
      episodeId,
      time: new Date().toISOString()
    };
    try {
      await redisCommand(["LPUSH", "quarantine:events", JSON.stringify(event)]);
      await redisCommand(["LTRIM", "quarantine:events", "0", "49"]);
    } catch (redisErr) { }

    sendDegradedStream(req, res, err);
    const degraded = classifyFailure({ error: err, source: "broker" });
    return {
      handled: true,
      outcome: {
        source: degraded.source,
        cause: degraded.cause,
        result: "degraded"
      }
    };
  } finally {
    pruneLatestSelections();
  }
}

async function handleQuarantine(req, res) {
  const eventsRaw = await redisCommand(["LRANGE", "quarantine:events", "0", "-1"]);
  const slotTaken = await redisCommand(["GET", "stats:slot_taken"]) || 0;
  const brokerErrors = await redisCommand(["GET", "stats:broker_error"]) || 0;
  const activeCount = await redisCommand(["ZCARD", "system:active_sessions"]) || 0;

  const events = eventsRaw.map(e => {
    try {
      const event = JSON.parse(e);
      return {
        time: event.time || "",
        ip: redactIp(event.ip),
        episodeId: event.episodeId || "",
        error: sanitizeInternalError(event.error)
      };
    } catch {
      return { time: "", ip: "unknown", episodeId: "", error: "internal_error" };
    }
  });

  const rows = events.map(e => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #444">${e.time || ""}</td>
      <td style="padding:8px;border-bottom:1px solid #444">${e.ip || ""}</td>
      <td style="padding:8px;border-bottom:1px solid #444">${e.episodeId || ""}</td>
      <td style="padding:8px;border-bottom:1px solid #444;color:#ff6b6b">${e.error || ""}</td>
    </tr>
  `).join("");

  const html = `
    <html>
      <body style="background:#1a1a1a;color:#eee;font-family:sans-serif;padding:2rem">
        <h2>Quarantine Events (Last 50)</h2>
        <p><b>Stats:</b> Active Sessions: ${activeCount}/${MAX_SESSIONS} | Slot Taken Blocks: ${slotTaken} | Broker Errors: ${brokerErrors}</p>
        <table style="width:100%;border-collapse:collapse;background:#2a2a2a">
          <thead>
            <tr style="background:#333">
              <th style="padding:8px;text-align:left">Time</th>
              <th style="padding:8px;text-align:left">IP</th>
              <th style="padding:8px;text-align:left">Episode</th>
              <th style="padding:8px;text-align:left">Error</th>
            </tr>
          </thead>
          <tbody>${rows || "<tr><td colspan='4' style='padding:20px;text-align:center'>No events</td></tr>"}</tbody>
        </table>
        <br><a href="/" style="color:#8A5BB8">Back to Home</a>
      </body>
    </html>
  `;
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html");
  applyCors(req, res);
  res.end(html);
}

module.exports = async function (req, res) {
  return withRequestContext(req, async () => {
    bindResponseCorrelationId(res);
    const startedAt = Date.now();
    const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = reqUrl.pathname;
    const routeType = classifyRoute(pathname);
    let reliabilityOutcome = null;

    function setReliabilityOutcome(outcome = {}) {
      reliabilityOutcome = {
        source: outcome.source || (reliabilityOutcome && reliabilityOutcome.source) || "policy",
        cause: outcome.cause || (reliabilityOutcome && reliabilityOutcome.cause) || "success",
        result: outcome.result || (reliabilityOutcome && reliabilityOutcome.result) || "success"
      };
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

      if (routeType === "operator") {
        const authz = authorizeOperator({
          expectedToken: process.env.OPERATOR_TOKEN || "",
          headers: req.headers || {}
        });
        emitTelemetry(EVENTS.POLICY_DECISION, {
          ...classifyFailure({ code: authz.error || "operator_allowed", source: "policy" }),
          route: pathname,
          allowed: Boolean(authz.allowed)
        });
        if (!authz.allowed) {
          setReliabilityOutcome({
            source: "policy",
            cause: authz.error || "operator_forbidden",
            result: "failure"
          });
          sendJson(req, res, authz.statusCode, { error: authz.error });
          return;
        }
      }

      if (pathname === "/") {
        setReliabilityOutcome({ source: "policy", cause: "success", result: "success" });
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html");
        applyCors(req, res);
        bindResponseCorrelationId(res);
        res.end(getLandingPageHtml());
        return;
      }

      if (pathname === "/health") {
        setReliabilityOutcome({ source: "policy", cause: "success", result: "success" });
        sendJson(req, res, 200, { status: "OK" });
        return;
      }

      if (pathname === "/health/details") {
        try {
          await redisCommand(["PING"]);
          const reliability = await readReliabilitySummary(redisCommand);
          setReliabilityOutcome({ source: "redis", cause: "success", result: "success" });
          sendJson(req, res, 200, projectOperatorHealth({
            redisStatus: "connected",
            reliability
          }));
        } catch {
          setReliabilityOutcome({ source: "redis", cause: "dependency_unavailable", result: "failure" });
          sendJson(req, res, 503, projectOperatorHealth({
            redisStatus: "unavailable",
            reliability: {}
          }));
        }
        return;
      }

      if (pathname === "/operator/metrics") {
        try {
          await redisCommand(["PING"]);
          const reliability = await readReliabilitySummary(redisCommand);
          setReliabilityOutcome({ source: "redis", cause: "success", result: "success" });
          sendJson(req, res, 200, projectOperatorMetrics({
            redisStatus: "connected",
            reliability
          }));
        } catch {
          setReliabilityOutcome({ source: "redis", cause: "dependency_unavailable", result: "failure" });
          sendJson(req, res, 503, projectOperatorMetrics({
            redisStatus: "unavailable",
            reliability: {}
          }));
        }
        return;
      }

      if (pathname === "/quarantine") {
        try {
          await handleQuarantine(req, res);
          setReliabilityOutcome({ source: "redis", cause: "success", result: "success" });
        } catch {
          setReliabilityOutcome({ source: "redis", cause: "internal_error", result: "failure" });
          sendJson(req, res, 500, { error: "internal_error" });
        }
        return;
      }

      try {
        const controlResult = await applyRoutingRequestControls(
          { req, pathname },
          requestControlDependencies
        );

        if (!controlResult.allowed) {
          const deniedCause = classifyReliabilityCause(controlResult.reason || "blocked:slot_taken");
          if (pathname.startsWith("/stream/")) {
            setReliabilityOutcome({ source: "policy", cause: deniedCause, result: "degraded" });
            sendDegradedStream(req, res, controlResult.reason);
            return;
          }
          setReliabilityOutcome({ source: "policy", cause: deniedCause, result: "failure" });
          sendPublicError(req, res, 503);
          return;
        }

        if (pathname.startsWith("/stream/")) {
          const streamResult = await handleStreamRequest(req, res, pathname, controlResult.ip || getTrustedClientIp(req));
          if (streamResult && streamResult.handled) {
            setReliabilityOutcome(streamResult.outcome || {});
            return;
          }
        }
      } catch (error) {
        const failure = classifyFailure({ error });
        if (pathname.startsWith("/stream/")) {
          setReliabilityOutcome({ source: failure.source, cause: failure.cause, result: "degraded" });
          sendDegradedStream(req, res, error);
          return;
        }
        setReliabilityOutcome({ source: failure.source, cause: failure.cause, result: "failure" });
        sendPublicError(req, res, 503);
        return;
      }

      applyCors(req, res);
      bindResponseCorrelationId(res);
      router(req, res, () => {
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
    }
  });
};
