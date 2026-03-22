const FIELD_SEPARATOR = "|";
const KV_SEPARATOR = "=";

const BOUNDED_DIMENSIONS = Object.freeze({
  source: ["d", "redis", "validation", "policy", "unknown"],
  cause: [
    "success",
    "admitted",
    "capacity_busy",
    "dependency_timeout",
    "dependency_unavailable",
    "validation_invalid_stream_url",
    "operator_token_required",
    "operator_forbidden",
    "operator_auth_unconfigured",
    "service_unavailable",
    "internal_error",
    "other"
  ],
  routeClass: ["stremio", "operator", "public", "unknown"],
  result: ["success", "degraded", "failure"]
});

function normalizeBoundedValue(dimension, value) {
  const allowedValues = BOUNDED_DIMENSIONS[dimension] || [];
  const fallback = dimension === "cause" ? "other" : "unknown";
  const normalized = String(value || "").trim().toLowerCase();

  if (allowedValues.includes(normalized)) {
    return normalized;
  }

  if (dimension === "cause") {
    if (normalized.includes("timeout")) return "dependency_timeout";
    if (normalized.includes("capacity") || normalized.includes("slot") || normalized.includes("blocked")) return "capacity_busy";
    if (normalized.includes("valid")) return "validation_invalid_stream_url";
    if (normalized.includes("token_required")) return "operator_token_required";
    if (normalized.includes("forbidden")) return "operator_forbidden";
    if (normalized.includes("auth_unconfigured")) return "operator_auth_unconfigured";
    if (normalized.includes("service_unavailable")) return "service_unavailable";
    if (normalized.includes("internal")) return "internal_error";
    if (normalized.includes("unavailable") || normalized.includes("redis")) {
      return "dependency_unavailable";
    }
  }

  if (dimension === "source") {
    if (normalized === "d") return "d";
    if (normalized.includes("redis")) return "redis";
    if (normalized.includes("valid")) return "validation";
    if (normalized.includes("policy") || normalized.includes("operator")) return "policy";
    if (normalized.includes("broker")) return "d";
  }

  return fallback;
}

function normalizeLabels(labels = {}) {
  return {
    source: normalizeBoundedValue("source", labels.source),
    cause: normalizeBoundedValue("cause", labels.cause),
    routeClass: normalizeBoundedValue("routeClass", labels.routeClass),
    result: normalizeBoundedValue("result", labels.result)
  };
}

function encodeField(labels) {
  const normalized = normalizeLabels(labels);
  return [
    `source${KV_SEPARATOR}${normalized.source}`,
    `cause${KV_SEPARATOR}${normalized.cause}`,
    `routeClass${KV_SEPARATOR}${normalized.routeClass}`,
    `result${KV_SEPARATOR}${normalized.result}`
  ].join(FIELD_SEPARATOR);
}

function decodeField(field) {
  const pairs = String(field || "").split(FIELD_SEPARATOR);
  const decoded = {};

  for (const pair of pairs) {
    const [key, value] = pair.split(KV_SEPARATOR);
    if (key) {
      decoded[key] = value || "";
    }
  }

  return normalizeLabels(decoded);
}

// In-memory reliability counter store.
// State is per-instance and resets on cold start — this is accepted behavior.
// Counter increments are safe without locks: Node.js is single-threaded (no
// preemption between read and write even under Fluid Compute in-process concurrency).
// The _redisCommand first parameter is vestigial from an original Redis design;
// it is ignored here but kept for forward-compat if Redis persistence is added later.
const _counters = new Map();

async function incrementReliabilityCounter(_redisCommand, labels = {}) {
  const normalized = normalizeLabels(labels);
  const key = encodeField(normalized);
  _counters.set(key, (_counters.get(key) || 0) + 1);
  return normalized;
}

async function readReliabilitySummary(_redisCommand) {
  const metrics = [];
  let overall = 0, success = 0, degraded = 0, failure = 0;
  const bySource = {}, byCause = {}, byRouteClass = {};

  for (const [key, count] of _counters) {
    const labels = decodeField(key);
    metrics.push({ ...labels, count });
    overall += count;
    if (labels.result === "success") success += count;
    if (labels.result === "degraded") degraded += count;
    if (labels.result === "failure") failure += count;
    bySource[labels.source] = (bySource[labels.source] || 0) + count;
    byCause[labels.cause] = (byCause[labels.cause] || 0) + count;
    byRouteClass[labels.routeClass] = (byRouteClass[labels.routeClass] || 0) + count;
  }

  return {
    dimensions: BOUNDED_DIMENSIONS,
    totals: { success, degraded, failure, overall },
    bySource,
    byCause,
    byRouteClass,
    metrics,
    lastUpdated: overall > 0 ? new Date().toISOString() : null
  };
}

module.exports = {
  BOUNDED_DIMENSIONS,
  incrementReliabilityCounter,
  readReliabilitySummary,
  normalizeLabels,
  encodeField,
  decodeField
};
