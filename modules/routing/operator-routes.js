async function handleOperatorRoute(input = {}, injected = {}) {
  const req = input.req;
  const res = input.res;
  const pathname = String(input.pathname || "");

  const sendJson = injected.sendJson;
  if (typeof sendJson !== "function") {
    throw new Error("handleOperatorRoute requires injected.sendJson");
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

  return { handled: false };
}

module.exports = {
  handleOperatorRoute
};
