const defaultTimeWindow = require("../policy/time-window");

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

  if (typeof injected.redisCommand === "function" && info.hour >= 1 && info.dateStr) {
    const resetKey = `system:reset:${info.dateStr}`;
    const resetTtlSec = String(injected.resetTtlSec || 86400);
    const resetTarget = String(injected.resetTarget || "quarantine:events");
    const alreadyReset = await injected.redisCommand(["GET", resetKey]);
    if (!alreadyReset) {
      await injected.redisCommand(["DEL", resetTarget]);
      await injected.redisCommand(["SET", resetKey, "1", "EX", resetTtlSec]);
    }
  }

  const getTrustedClientIp = injected.getTrustedClientIp;
  const ip = typeof getTrustedClientIp === "function" ? getTrustedClientIp(req) : "unknown";

  if (typeof injected.runSessionGate === "function") {
    const gateDecision = await injected.runSessionGate(ip, Date.now());
    if (!gateDecision.allowed) {
      return {
        allowed: false,
        reason: gateDecision.reason || "blocked:slot_taken"
      };
    }
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
