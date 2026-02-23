const { authorizeOperator } = require("../policy/operator-auth");
const {
  projectHealthDiagnostics,
  projectMetricsDiagnostics
} = require("../presentation/operator-diagnostics");
const { renderQuarantinePage } = require("../presentation/quarantine-page");
const { toHourBucket } = require("../analytics/hourly-tracker");
const {
  readActiveSessionCount
} = require("../analytics/session-view");
const {
  listDailySummaryDays,
  readDailySummary
} = require("../analytics/daily-summary-store");
const { runNightlyRollup } = require("../analytics/nightly-rollup");

function isOperatorRoute(pathname = "") {
  return (
    pathname === "/quarantine" ||
    pathname === "/health/details" ||
    pathname === "/operator/analytics" ||
    pathname.startsWith("/operator/rollup/") ||
    pathname.startsWith("/operator/") ||
    pathname.startsWith("/admin/")
  );
}

async function handleOperatorRoute(input = {}, injected = {}) {
  const req = input.req;
  const res = input.res;
  const pathname = String(input.pathname || "");

  if (!isOperatorRoute(pathname)) {
    return { handled: false };
  }

  const sendJson = injected.sendJson;
  if (typeof sendJson !== "function") {
    throw new Error("handleOperatorRoute requires injected.sendJson");
  }

  const emitTelemetry = injected.emitTelemetry;
  const classifyFailure = injected.classifyFailure || ((value) => ({ source: "policy", cause: value.code || "operator_forbidden" }));
  const authz = authorizeOperator({
    expectedToken: injected.expectedToken || "",
    headers: req && req.headers ? req.headers : {}
  });

  if (typeof emitTelemetry === "function") {
    emitTelemetry(injected.events && injected.events.POLICY_DECISION, {
      ...classifyFailure({ code: authz.error || "operator_allowed", source: "policy" }),
      route: pathname,
      allowed: Boolean(authz.allowed)
    });
  }

  if (!authz.allowed) {
    sendJson(req, res, authz.statusCode, { error: authz.error });
    return {
      handled: true,
      outcome: {
        source: "policy",
        cause: authz.error || "operator_forbidden",
        result: "failure"
      }
    };
  }

  const redisCommand = injected.redisCommand;
  const readReliabilitySummary = injected.readReliabilitySummary;

  if (pathname === "/health/details") {
    try {
      if (typeof redisCommand === "function") {
        await redisCommand(["PING"]);
      }

      const reliability = typeof readReliabilitySummary === "function"
        ? await readReliabilitySummary(redisCommand)
        : {};
      sendJson(req, res, 200, projectHealthDiagnostics({
        redisStatus: "connected",
        reliability
      }));
      return { handled: true, outcome: { source: "redis", cause: "success", result: "success" } };
    } catch {
      sendJson(req, res, 503, projectHealthDiagnostics({
        redisStatus: "unavailable",
        reliability: {}
      }));
      return { handled: true, outcome: { source: "redis", cause: "dependency_unavailable", result: "failure" } };
    }
  }

  if (pathname === "/operator/metrics") {
    try {
      if (typeof redisCommand === "function") {
        await redisCommand(["PING"]);
      }

      const reliability = typeof readReliabilitySummary === "function"
        ? await readReliabilitySummary(redisCommand)
        : {};
      sendJson(req, res, 200, projectMetricsDiagnostics({
        redisStatus: "connected",
        reliability
      }));
      return { handled: true, outcome: { source: "redis", cause: "success", result: "success" } };
    } catch {
      sendJson(req, res, 503, projectMetricsDiagnostics({
        redisStatus: "unavailable",
        reliability: {}
      }));
      return { handled: true, outcome: { source: "redis", cause: "dependency_unavailable", result: "failure" } };
    }
  }

  if (pathname === "/operator/analytics") {
    try {
      if (typeof redisCommand !== "function") {
        throw new Error("handleOperatorRoute requires injected.redisCommand for /operator/analytics");
      }

      const nowMs = Date.now();
      const hourBucket = toHourBucket({ nowMs });
      const hourlyKey = `analytics:hourly:${hourBucket}`;
      const hourlyRaw = await redisCommand(["HGETALL", hourlyKey]);
      const hourlyMap = {};
      if (Array.isArray(hourlyRaw)) {
        for (let index = 0; index < hourlyRaw.length; index += 2) {
          const field = String(hourlyRaw[index] || "");
          if (!field) continue;
          hourlyMap[field] = Number(hourlyRaw[index + 1] || 0);
        }
      }

      const activeSessionViews = await readActiveSessionCount(redisCommand, {
        ttlSec: injected.sessionViewTtlSec
      });
      const dailyDays = await listDailySummaryDays(redisCommand);
      const latestDay = dailyDays.length ? dailyDays[dailyDays.length - 1] : null;
      const latestSummary = latestDay ? await readDailySummary(redisCommand, latestDay) : null;

      sendJson(req, res, 200, {
        status: "OK",
        generatedAt: new Date().toISOString(),
        realtime: {
          activeSessionViews,
          currentHourKey: hourlyKey,
          currentHour: hourlyMap
        },
        dailySummary: {
          daysTracked: dailyDays.length,
          latestDay,
          latest: latestSummary
        }
      });

      return { handled: true, outcome: { source: "redis", cause: "success", result: "success" } };
    } catch {
      sendJson(req, res, 500, { error: "internal_error" });
      return { handled: true, outcome: { source: "redis", cause: "internal_error", result: "failure" } };
    }
  }

  if (pathname === "/operator/rollup/nightly") {
    try {
      if (typeof redisCommand !== "function") {
        throw new Error("handleOperatorRoute requires injected.redisCommand for /operator/rollup/nightly");
      }

      const reqUrl = new URL(req.url || "/operator/rollup/nightly", "http://localhost");
      const day = String(reqUrl.searchParams.get("day") || "").trim();
      const now = new Date();
      const defaultDay = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
      const result = await runNightlyRollup(redisCommand, {
        day: day || defaultDay,
        force: reqUrl.searchParams.get("force") === "1"
      });
      sendJson(req, res, 200, result);
      return { handled: true, outcome: { source: "redis", cause: "success", result: "success" } };
    } catch {
      sendJson(req, res, 500, { error: "internal_error" });
      return { handled: true, outcome: { source: "redis", cause: "internal_error", result: "failure" } };
    }
  }

  if (pathname === "/quarantine") {
    try {
      const redisCommand = injected.redisCommand;
      if (typeof redisCommand !== "function") {
        throw new Error("handleOperatorRoute requires injected.redisCommand for /quarantine");
      }

      const eventsRaw = await redisCommand(["LRANGE", "quarantine:events", "0", "-1"]);
      const slotTaken = await redisCommand(["GET", "stats:slot_taken"]) || 0;
      const brokerErrors = await redisCommand(["GET", "stats:broker_error"]) || 0;
      const activeCount = await redisCommand(["ZCARD", "system:active_sessions"]) || 0;

      const html = renderQuarantinePage({
        eventsRaw,
        activeCount,
        slotTaken,
        brokerErrors,
        maxSessions: injected.maxSessions
      });

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html");
      if (typeof injected.applyCors === "function") {
        injected.applyCors(req, res);
      }
      res.end(html);
      return { handled: true, outcome: { source: "redis", cause: "success", result: "success" } };
    } catch {
      sendJson(req, res, 500, { error: "internal_error" });
      return { handled: true, outcome: { source: "redis", cause: "internal_error", result: "failure" } };
    }
  }

  return { handled: false };
}

module.exports = {
  isOperatorRoute,
  handleOperatorRoute
};
