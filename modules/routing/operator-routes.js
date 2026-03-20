const { authorizeOperator } = require("../policy/operator-auth");
const {
  projectHealthDiagnostics,
  projectMetricsDiagnostics
} = require("../presentation/operator-diagnostics");
const { getLogger } = require("../../observability/logger");

const logger = getLogger({ component: "operator-routes" });

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

  if (pathname === "/health/details") {
    sendJson(req, res, 200, projectHealthDiagnostics({
      redisStatus: "none",
      reliability: {}
    }));
    return { handled: true, outcome: { source: "policy", cause: "success", result: "success" } };
  }

  if (pathname === "/operator/metrics") {
    sendJson(req, res, 200, projectMetricsDiagnostics({
      redisStatus: "none",
      reliability: {}
    }));
    return { handled: true, outcome: { source: "policy", cause: "success", result: "success" } };
  }

  if (pathname === "/operator/analytics") {
    sendJson(req, res, 501, {
      error: "not_supported",
      detail: "Analytics require Redis which has been removed."
    });
    return { handled: true, outcome: { source: "policy", cause: "not_supported", result: "failure" } };
  }

  if (pathname === "/operator/rollup/nightly") {
    sendJson(req, res, 501, { error: "not_supported" });
    return { handled: true, outcome: { source: "policy", cause: "not_supported", result: "failure" } };
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

    sendJson(req, res, 501, { error: "not_supported" });
    return { handled: true, outcome: { source: "policy", cause: "not_supported", result: "failure" } };
  }

  if (pathname === "/quarantine") {
    sendJson(req, res, 501, { error: "not_supported" });
    return { handled: true, outcome: { source: "policy", cause: "not_supported", result: "failure" } };
  }

  return { handled: false };
}

module.exports = {
  isOperatorRoute,
  handleOperatorRoute
};
