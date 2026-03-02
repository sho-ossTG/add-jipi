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
const { getLogger } = require("../../observability/logger");

const logger = getLogger({ component: "operator-routes" });

function isValidDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return false;
  }

  const [yearRaw, monthRaw, dayRaw] = day.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const dayOfMonth = Number(dayRaw);
  const parsed = new Date(Date.UTC(year, month - 1, dayOfMonth));
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(dayOfMonth) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === dayOfMonth
  );
}

function parsePendingDay(req) {
  const reqUrl = new URL(req.url || "/operator/logs/pending", "http://localhost");
  const day = String(reqUrl.searchParams.get("day") || "").trim();
  if (!isValidDay(day)) {
    return { valid: false, day: "" };
  }
  return { valid: true, day };
}

function parseEventEntry(raw) {
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function eventMatchesDay(event, day) {
  if (!event || typeof event !== "object") {
    return false;
  }
  const time = event.time;
  if (typeof time !== "string") {
    return false;
  }
  return time.slice(0, 10) === day;
}

function parseHourlySnapshot(raw = [], bucket = "") {
  const currentHour = {};
  if (!Array.isArray(raw)) {
    return currentHour;
  }

  for (let index = 0; index < raw.length; index += 2) {
    const field = String(raw[index] || "");
    const value = String(raw[index + 1] || "");
    const parts = field.split("|");
    if (parts.length !== 3) continue;
    const [fieldBucket, eventName, metric] = parts;
    if (fieldBucket !== bucket || !eventName) continue;
    if (!currentHour[eventName]) {
      currentHour[eventName] = {
        count: 0,
        first_seen: null,
        last_seen: null
      };
    }

    if (metric === "count") {
      currentHour[eventName].count = Number(value || 0);
    } else if (metric === "first_seen") {
      currentHour[eventName].first_seen = value || null;
    } else if (metric === "last_seen") {
      currentHour[eventName].last_seen = value || null;
    }
  }

  return currentHour;
}

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
      const hourlyKey = "analytics:hourly";
      const hourlyRaw = await redisCommand(["HGETALL", hourlyKey]);
      const hourlyMap = parseHourlySnapshot(hourlyRaw, hourBucket);

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

  if (pathname === "/operator/logs/pending") {
    const method = String((req && req.method) || "GET").toUpperCase();
    if (method !== "GET" && method !== "DELETE") {
      sendJson(req, res, 405, { error: "method_not_allowed" });
      return {
        handled: true,
        outcome: { source: "policy", cause: "method_not_allowed", result: "failure" }
      };
    }

    const pendingDay = parsePendingDay(req);
    if (!pendingDay.valid) {
      sendJson(req, res, 400, { error: "invalid_day" });
      return {
        handled: true,
        outcome: { source: "policy", cause: "invalid_day", result: "failure" }
      };
    }

    if (method === "GET") {
      try {
        if (typeof redisCommand !== "function") {
          throw new Error("handleOperatorRoute requires injected.redisCommand for /operator/logs/pending");
        }

        const eventsRaw = await redisCommand(["LRANGE", "quarantine:events", "0", "-1"]);
        const events = Array.isArray(eventsRaw)
          ? eventsRaw
            .map((entry) => parseEventEntry(entry))
            .filter((event) => eventMatchesDay(event, pendingDay.day))
          : [];

        logger.info({ day: pendingDay.day, eventCount: events.length }, "operator_logs_pending_read");
        sendJson(req, res, 200, {
          day: pendingDay.day,
          events
        });
        return { handled: true, outcome: { source: "redis", cause: "success", result: "success" } };
      } catch (error) {
        logger.warn({ day: pendingDay.day, error: error && error.message }, "operator_logs_pending_read_failed");
        sendJson(req, res, 503, { error: "dependency_unavailable" });
        return {
          handled: true,
          outcome: { source: "redis", cause: "dependency_unavailable", result: "failure" }
        };
      }
    }

    try {
      if (typeof redisCommand !== "function") {
        throw new Error("handleOperatorRoute requires injected.redisCommand for /operator/logs/pending");
      }

      const eventsRaw = await redisCommand(["LRANGE", "quarantine:events", "0", "-1"]);
      const rawEntries = Array.isArray(eventsRaw) ? eventsRaw : [];
      let removed = 0;

      for (const rawEntry of rawEntries) {
        const parsed = parseEventEntry(rawEntry);
        if (!eventMatchesDay(parsed, pendingDay.day)) {
          continue;
        }
        const removedRaw = await redisCommand(["LREM", "quarantine:events", "1", String(rawEntry)]);
        const removedCount = Number(removedRaw);
        if (Number.isFinite(removedCount) && removedCount > 0) {
          removed += removedCount;
        }
      }

      logger.info({ day: pendingDay.day, removed }, "operator_logs_pending_delete");
      sendJson(req, res, 200, {
        day: pendingDay.day,
        removed
      });
      return { handled: true, outcome: { source: "redis", cause: "success", result: "success" } };
    } catch (error) {
      logger.warn({ day: pendingDay.day, error: error && error.message }, "operator_logs_pending_delete_failed");
      sendJson(req, res, 503, { error: "dependency_unavailable" });
      return {
        handled: true,
        outcome: { source: "redis", cause: "dependency_unavailable", result: "failure" }
      };
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
      const resolutionErrors = await redisCommand(["GET", "stats:d_error"]) || 0;
      const activeCount = await redisCommand(["ZCARD", "system:active_sessions"]) || 0;

      const html = renderQuarantinePage({
        eventsRaw,
        activeCount,
        slotTaken,
        resolutionErrors,
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
