const { authorizeOperator } = require("../policy/operator-auth");

function isOperatorRoute(pathname = "") {
  return (
    pathname === "/quarantine" ||
    pathname === "/health/details" ||
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
      const projectOperatorHealth = injected.projectOperatorHealth || ((payload) => payload);
      sendJson(req, res, 200, projectOperatorHealth({
        redisStatus: "connected",
        reliability
      }));
      return { handled: true, outcome: { source: "redis", cause: "success", result: "success" } };
    } catch {
      const projectOperatorHealth = injected.projectOperatorHealth || ((payload) => payload);
      sendJson(req, res, 503, projectOperatorHealth({
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
      const projectOperatorMetrics = injected.projectOperatorMetrics || ((payload) => payload);
      sendJson(req, res, 200, projectOperatorMetrics({
        redisStatus: "connected",
        reliability
      }));
      return { handled: true, outcome: { source: "redis", cause: "success", result: "success" } };
    } catch {
      const projectOperatorMetrics = injected.projectOperatorMetrics || ((payload) => payload);
      sendJson(req, res, 503, projectOperatorMetrics({
        redisStatus: "unavailable",
        reliability: {}
      }));
      return { handled: true, outcome: { source: "redis", cause: "dependency_unavailable", result: "failure" } };
    }
  }

  if (pathname === "/quarantine") {
    try {
      if (typeof injected.handleQuarantine !== "function") {
        throw new Error("handleOperatorRoute requires injected.handleQuarantine for /quarantine");
      }
      await injected.handleQuarantine(req, res);
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
