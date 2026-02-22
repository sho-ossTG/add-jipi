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

async function applyRequestControls(input = {}, injected = {}) {
  const req = input.req;
  const pathname = String(input.pathname || "");

  const isStremioRoute = injected.isStremioRoute;
  if (typeof isStremioRoute === "function" && !isStremioRoute(pathname)) {
    return { allowed: true };
  }

  const timeWindow = injected.timeWindow || defaultTimeWindow;
  const getJerusalemInfo =
    typeof timeWindow.getJerusalemInfo === "function"
      ? timeWindow.getJerusalemInfo
      : () => ({ hour: 0, dateStr: "" });
  const isWithinShutdownWindow =
    typeof timeWindow.isWithinShutdownWindow === "function"
      ? timeWindow.isWithinShutdownWindow
      : () => false;

  const info = getJerusalemInfo(injected.clock || timeWindow.createJerusalemClock && timeWindow.createJerusalemClock());
  if (isWithinShutdownWindow(info, injected.shutdownWindow || {})) {
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

  const redisCommand = resolveRedisCommand(injected);

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

  const getTrustedClientIp = injected.getTrustedClientIp;
  const ip = typeof getTrustedClientIp === "function" ? getTrustedClientIp(req) : "unknown";

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

  return { allowed: true, ip };
}

module.exports = {
  applyRequestControls
};
