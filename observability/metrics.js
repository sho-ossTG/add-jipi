const FIELD_SEPARATOR = "|";
const KV_SEPARATOR = "=";

const RELIABILITY_HASH_KEY = "stats:reliability:counters";
const RELIABILITY_LAST_UPDATED_KEY = "stats:reliability:last_updated";

const BOUNDED_DIMENSIONS = Object.freeze({
  source: ["broker", "redis", "validation", "policy", "unknown"],
  cause: [
    "success",
    "admitted",
    "policy_shutdown",
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
    if (normalized.includes("shutdown")) return "policy_shutdown";
    if (normalized.includes("valid")) return "validation_invalid_stream_url";
    if (normalized.includes("token_required")) return "operator_token_required";
    if (normalized.includes("forbidden")) return "operator_forbidden";
    if (normalized.includes("auth_unconfigured")) return "operator_auth_unconfigured";
    if (normalized.includes("service_unavailable")) return "service_unavailable";
    if (normalized.includes("internal")) return "internal_error";
    if (normalized.includes("unavailable") || normalized.includes("broker") || normalized.includes("redis")) {
      return "dependency_unavailable";
    }
  }

  if (dimension === "source") {
    if (normalized.includes("redis")) return "redis";
    if (normalized.includes("valid")) return "validation";
    if (normalized.includes("policy") || normalized.includes("operator")) return "policy";
    if (normalized.includes("broker")) return "broker";
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

function parseHashResponse(hashResponse) {
  if (!hashResponse) return [];
  const entries = [];

  if (Array.isArray(hashResponse)) {
    for (let index = 0; index < hashResponse.length; index += 2) {
      entries.push([hashResponse[index], hashResponse[index + 1]]);
    }
    return entries;
  }

  if (typeof hashResponse === "object") {
    return Object.entries(hashResponse);
  }

  return [];
}

async function incrementReliabilityCounter(redisCommand, labels = {}, amount = 1) {
  const normalized = normalizeLabels(labels);
  const field = encodeField(normalized);
  const incrementBy = String(Math.max(1, Number(amount) || 1));

  await redisCommand(["HINCRBY", RELIABILITY_HASH_KEY, field, incrementBy]);
  await redisCommand(["SET", RELIABILITY_LAST_UPDATED_KEY, new Date().toISOString(), "EX", "86400"]);

  return normalized;
}

async function readReliabilitySummary(redisCommand) {
  const hashResponse = await redisCommand(["HGETALL", RELIABILITY_HASH_KEY]);
  const lastUpdated = await redisCommand(["GET", RELIABILITY_LAST_UPDATED_KEY]);
  const entries = parseHashResponse(hashResponse);

  const metrics = [];
  const totals = {
    success: 0,
    degraded: 0,
    failure: 0,
    overall: 0
  };
  const bySource = {};
  const byCause = {};
  const byRouteClass = {};

  for (const [field, rawCount] of entries) {
    const labels = decodeField(field);
    const count = Number(rawCount || 0);

    if (!Number.isFinite(count) || count <= 0) {
      continue;
    }

    metrics.push({ labels, count });

    totals.overall += count;
    totals[labels.result] += count;
    bySource[labels.source] = (bySource[labels.source] || 0) + count;
    byCause[labels.cause] = (byCause[labels.cause] || 0) + count;
    byRouteClass[labels.routeClass] = (byRouteClass[labels.routeClass] || 0) + count;
  }

  return {
    dimensions: BOUNDED_DIMENSIONS,
    totals,
    bySource,
    byCause,
    byRouteClass,
    metrics,
    lastUpdated: typeof lastUpdated === "string" ? lastUpdated : null
  };
}

module.exports = {
  BOUNDED_DIMENSIONS,
  RELIABILITY_HASH_KEY,
  incrementReliabilityCounter,
  readReliabilitySummary,
  normalizeLabels
};
