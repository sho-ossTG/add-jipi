const { BOUNDED_DIMENSIONS } = require("./metrics");

function sanitizeCountMap(input = {}) {
  const output = {};
  for (const [key, value] of Object.entries(input || {})) {
    output[String(key)] = Math.max(0, Number(value) || 0);
  }
  return output;
}

function sanitizeMetricSeries(metrics = []) {
  if (!Array.isArray(metrics)) return [];

  return metrics
    .map((entry) => ({
      labels: {
        source: String(entry && entry.labels && entry.labels.source ? entry.labels.source : "unknown"),
        cause: String(entry && entry.labels && entry.labels.cause ? entry.labels.cause : "other"),
        routeClass: String(entry && entry.labels && entry.labels.routeClass ? entry.labels.routeClass : "unknown"),
        result: String(entry && entry.labels && entry.labels.result ? entry.labels.result : "failure")
      },
      count: Math.max(0, Number(entry && entry.count) || 0)
    }))
    .filter((entry) => BOUNDED_DIMENSIONS.source.includes(entry.labels.source))
    .filter((entry) => BOUNDED_DIMENSIONS.cause.includes(entry.labels.cause))
    .filter((entry) => BOUNDED_DIMENSIONS.routeClass.includes(entry.labels.routeClass))
    .filter((entry) => BOUNDED_DIMENSIONS.result.includes(entry.labels.result));
}

function projectReliabilityPayload(reliability = {}) {
  const totals = reliability && reliability.totals ? reliability.totals : {};

  return {
    boundedDimensions: BOUNDED_DIMENSIONS,
    totals: {
      success: Math.max(0, Number(totals.success) || 0),
      degraded: Math.max(0, Number(totals.degraded) || 0),
      failure: Math.max(0, Number(totals.failure) || 0),
      overall: Math.max(0, Number(totals.overall) || 0)
    },
    bySource: sanitizeCountMap(reliability.bySource),
    byCause: sanitizeCountMap(reliability.byCause),
    byRouteClass: sanitizeCountMap(reliability.byRouteClass),
    metrics: sanitizeMetricSeries(reliability.metrics),
    lastUpdated: typeof reliability.lastUpdated === "string" ? reliability.lastUpdated : null
  };
}

function projectOperatorHealth(input = {}) {
  const redis = input.redisStatus === "connected" ? "connected" : "unavailable";
  return {
    status: redis === "connected" ? "OK" : "DEGRADED",
    dependencies: {
      redis
    },
    reliability: projectReliabilityPayload(input.reliability),
    generatedAt: new Date().toISOString()
  };
}

function projectOperatorMetrics(input = {}) {
  const redis = input.redisStatus === "connected" ? "connected" : "unavailable";
  return {
    status: redis === "connected" ? "OK" : "DEGRADED",
    reliability: projectReliabilityPayload(input.reliability),
    dependencies: {
      redis
    },
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  projectOperatorHealth,
  projectOperatorMetrics,
  projectReliabilityPayload
};
