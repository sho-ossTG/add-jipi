const defaultTimeWindow = require("../policy/time-window");
const { runAtomicSessionGate: defaultRunAtomicSessionGate } = require("../policy/session-gate");
const { createRedisClient } = require("../integrations/redis-client");

function resolveRedisCommand(injected = {}) {
  if (typeof injected.redisCommand === "function") {
    return injected.redisCommand;
  }

  if (injected.redisClient && typeof injected.redisClient.command === "function") {
    return injected.redisClient.command.bind(injected.redisClient);
  }

  const client = createRedisClient(injected.redisOptions || {});
  return client.command;
}

function resolveRedisEval(injected = {}, redisCommand) {
  if (typeof injected.redisEval === "function") {
    return injected.redisEval;
  }

  return async function redisEval(script, keys = [], args = []) {
    const commandParts = [
      "EVAL",
      script,
      String(keys.length),
      ...keys,
      ...args.map((value) => String(value))
    ];
    return redisCommand(commandParts);
  };
}

function previousDay(dateStr = "") {
  const value = String(dateStr || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year, month, day] = value.split("-").map((entry) => Number(entry));
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() - 1);
  const nextYear = String(utc.getUTCFullYear());
  const nextMonth = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(utc.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

async function applyRequestControls(input = {}, injected = {}) {
  const req = input.req;
  const pathname = String(input.pathname || "");

  const isStremioRoute = injected.isStremioRoute;
  if (typeof isStremioRoute === "function" && !isStremioRoute(pathname)) {
    return { allowed: true };
  }

  const timeWindow = injected.timeWindow || defaultTimeWindow;
  const getBeirutInfo =
    typeof timeWindow.getBeirutInfo === "function"
      ? timeWindow.getBeirutInfo
      : () => ({ hour: 0, dateStr: "" });
  const isWithinShutdownWindow =
    typeof timeWindow.isWithinShutdownWindow === "function"
      ? timeWindow.isWithinShutdownWindow
      : () => false;

  const info = getBeirutInfo(injected.clock || timeWindow.createBeirutClock && timeWindow.createBeirutClock());
  const redisCommand = resolveRedisCommand(injected);
  const analyticsBucket = info && info.dateStr && Number.isFinite(info.hour)
    ? `${info.dateStr}-${String(info.hour).padStart(2, "0")}`
    : "";

  async function trackPolicyEvent(fields = [], uniqueId = "") {
    if (typeof injected.trackHourlyEvent !== "function") {
      return;
    }

    try {
      await injected.trackHourlyEvent(redisCommand, {
        bucket: analyticsBucket,
        fields,
        uniqueId,
        ttlSec: injected.hourlyAnalyticsTtlSec
      }, {
        ttlSec: injected.hourlyAnalyticsTtlSec
      });
    } catch {
      // Hourly analytics are best-effort and must not affect requests.
    }
  }

  async function runNightlyMaintenance() {
    if (typeof injected.runNightlyRollup !== "function") {
      return;
    }

    const day = previousDay(info && info.dateStr);
    if (!day) {
      return;
    }

    try {
      await injected.runNightlyRollup(redisCommand, { day });
    } catch {
      // Nightly maintenance is best-effort and must not block request flow.
    }
  }

  const getTrustedClientIp = injected.getTrustedClientIp;
  const ip = typeof getTrustedClientIp === "function" ? getTrustedClientIp(req) : "unknown";

  if (isWithinShutdownWindow(info, injected.shutdownWindow || {})) {
    await runNightlyMaintenance();
    await trackPolicyEvent([
      "requests.total",
      "policy.blocked",
      "policy.blocked:shutdown_window"
    ], ip);
    if (typeof injected.emitTelemetry === "function") {
      const classifyFailure = injected.classifyFailure || ((value) => ({ source: "policy", cause: value.reason || "blocked:shutdown_window" }));
      injected.emitTelemetry(injected.events && injected.events.POLICY_DECISION, {
        ...classifyFailure({ reason: "blocked:shutdown_window" }),
        route: pathname,
        allowed: false
      });
    }
    return { allowed: false, reason: "blocked:shutdown_window" };
  }

  if (info.hour >= 1 && info.dateStr) {
    const resetKey = `system:reset:${info.dateStr}`;
    const resetTtlSec = String(injected.resetTtlSec || 86400);
    const resetTarget = String(injected.resetTarget || "quarantine:events");
    const alreadyReset = await redisCommand(["GET", resetKey]);
    if (!alreadyReset) {
      await redisCommand(["DEL", resetTarget]);
      await redisCommand(["SET", resetKey, "1", "EX", resetTtlSec]);
    }
  }

  const runSessionGate =
    typeof injected.runSessionGate === "function"
      ? injected.runSessionGate
      : defaultRunAtomicSessionGate;
  const nowMs =
    typeof injected.nowMs === "function"
      ? injected.nowMs()
      : Date.now();

  const gateDecision = await runSessionGate({
    redisEval: resolveRedisEval(injected, redisCommand),
    ip,
    nowMs,
    sessionsKey: injected.sessionsKey,
    inactivityLimitSec: injected.inactivityLimitSec,
    maxSessions: injected.maxSessions,
    slotTtlSec: injected.slotTtlSec,
    reconnectGraceMs: injected.reconnectGraceMs,
    rotationIdleMs: injected.rotationIdleMs
  });

  if (!gateDecision.allowed) {
    await redisCommand(["INCR", String(injected.slotTakenStatKey || "stats:slot_taken")]);
    if (typeof injected.emitTelemetry === "function") {
      const classifyFailure = injected.classifyFailure || ((value) => ({ source: "policy", cause: value.reason || "blocked:slot_taken" }));
      injected.emitTelemetry(injected.events && injected.events.POLICY_DECISION, {
        ...classifyFailure({ reason: gateDecision.reason || "blocked:slot_taken" }),
        route: pathname,
        allowed: false
      });
    }

    await trackPolicyEvent([
      "requests.total",
      "policy.blocked",
      `policy.blocked:${String(gateDecision.reason || "blocked:slot_taken").replace(/^blocked:/, "")}`
    ], ip);

    return {
      allowed: false,
      reason: gateDecision.reason || "blocked:slot_taken"
    };
  }

  if (typeof injected.emitTelemetry === "function") {
    injected.emitTelemetry(injected.events && injected.events.POLICY_DECISION, {
      source: "policy",
      cause: "admitted",
      route: pathname,
      allowed: true
    });
  }

  await trackPolicyEvent([
    "requests.total",
    "policy.admitted"
  ], ip);

  return { allowed: true, ip };
}

module.exports = {
  applyRequestControls
};
