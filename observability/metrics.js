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

async function incrementReliabilityCounter(_redisCommand, labels = {}) {
  return normalizeLabels(labels);
}

async function readReliabilitySummary(_redisCommand) {
  return {
    dimensions: BOUNDED_DIMENSIONS,
    totals: { success: 0, degraded: 0, failure: 0, overall: 0 },
    bySource: {},
    byCause: {},
    byRouteClass: {},
    metrics: [],
    lastUpdated: null
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
