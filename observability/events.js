const { getCorrelationId } = require("./context");

const SOURCES = Object.freeze({
  D: "d",
  REDIS: "redis",
  VALIDATION: "validation",
  POLICY: "policy"
});

const CATEGORIES = Object.freeze({
  REQUEST: "request",
  POLICY: "policy",
  DEPENDENCY: "dependency",
  COMPLETION: "completion",
  VALIDATION: "validation"
});

const EVENTS = Object.freeze({
  REQUEST_START: "request.start",
  POLICY_DECISION: "policy.decision",
  DEPENDENCY_ATTEMPT: "dependency.attempt",
  DEPENDENCY_FAILURE: "dependency.failure",
  REQUEST_DEGRADED: "request.degraded",
  REQUEST_COMPLETE: "request.complete"
});

const EVENT_CATEGORY_MAP = Object.freeze({
  [EVENTS.REQUEST_START]: CATEGORIES.REQUEST,
  [EVENTS.POLICY_DECISION]: CATEGORIES.POLICY,
  [EVENTS.DEPENDENCY_ATTEMPT]: CATEGORIES.DEPENDENCY,
  [EVENTS.DEPENDENCY_FAILURE]: CATEGORIES.DEPENDENCY,
  [EVENTS.REQUEST_DEGRADED]: CATEGORIES.COMPLETION,
  [EVENTS.REQUEST_COMPLETE]: CATEGORIES.COMPLETION
});

const FAILURE_EVENTS = new Set([
  EVENTS.DEPENDENCY_FAILURE,
  EVENTS.REQUEST_DEGRADED
]);

function normalizeErrorValue(payload = {}, cause = "") {
  const rawError = typeof payload.error === "string" ? payload.error.trim() : "";
  if (rawError) return rawError;
  const rawCause = String(cause || "").trim();
  if (rawCause) return rawCause;
  return "dependency_unavailable";
}

function normalizeDetailValue(payload = {}, cause = "") {
  const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
  if (detail) return detail;

  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (message) return message;

  if (payload.error && typeof payload.error === "object") {
    const errorMessage = String(payload.error.message || payload.error.code || "").trim();
    if (errorMessage) return errorMessage;
  }

  return `Failure classified as ${String(cause || "dependency_unavailable")}.`;
}

function normalizeSource(sourceValue, causeValue) {
  const source = String(sourceValue || "").toLowerCase();
  if (Object.values(SOURCES).includes(source)) {
    return source;
  }

  const cause = String(causeValue || "").toLowerCase();
  if (source.includes("redis") || cause.includes("redis")) return SOURCES.REDIS;
  if (source.includes("valid") || cause.includes("valid")) return SOURCES.VALIDATION;
  if (source.includes("policy") || cause.includes("policy") || cause.includes("blocked") || cause.includes("capacity")) {
    return SOURCES.POLICY;
  }
  return SOURCES.D;
}

function classifyFailure(input = {}) {
  const reasonValue = typeof input === "string" ? input : input.reason;
  const reason = String(reasonValue || "").toLowerCase();
  if (reason === "blocked:shutdown_window") {
    return { source: SOURCES.POLICY, cause: "policy_shutdown" };
  }
  if (reason.startsWith("blocked:")) {
    return { source: SOURCES.POLICY, cause: "capacity_busy" };
  }

  const candidate = typeof input === "object" ? input : {};
  const error = candidate.error || input;
  const code = String((error && error.code) || candidate.code || "").toLowerCase();

  if (code.includes("valid") || code === "type_error") {
    return { source: SOURCES.VALIDATION, cause: code || "validation_error" };
  }

  if (code === "dependency_timeout" || code === "aborterror" || code === "etimedout" || code === "ecanceled") {
    const source = code.startsWith("redis_") ? SOURCES.REDIS : normalizeSource(candidate.source, code);
    return { source, cause: "dependency_timeout" };
  }

  if (code.startsWith("redis_") || code === "redis_config_missing") {
    return { source: SOURCES.REDIS, cause: code || "dependency_unavailable" };
  }

  if (code === "econnreset" || code === "enotfound" || code.endsWith("_http_error")) {
    return { source: normalizeSource(candidate.source, code), cause: "dependency_unavailable" };
  }

  if (code.startsWith("policy_") || code.startsWith("operator_")) {
    return { source: SOURCES.POLICY, cause: code };
  }

  return {
    source: normalizeSource(candidate.source, candidate.cause || code),
    cause: candidate.cause || code || "dependency_unavailable"
  };
}

function buildEvent(eventName, payload = {}) {
  const derived = classifyFailure(payload);
  const cause = payload.cause || derived.cause;
  const event = {
    ...payload,
    event: eventName,
    category: payload.category || EVENT_CATEGORY_MAP[eventName] || CATEGORIES.REQUEST,
    source: normalizeSource(payload.source || derived.source, cause),
    cause,
    correlationId: payload.correlationId || getCorrelationId()
  };

  if (FAILURE_EVENTS.has(eventName)) {
    event.error = normalizeErrorValue(payload, cause);
    event.detail = normalizeDetailValue(payload, cause);
  }

  return event;
}

function emitEvent(logger, eventName, payload = {}) {
  if (!logger || typeof logger.info !== "function") return null;
  const entry = buildEvent(eventName, payload);
  logger.info(entry);
  return entry;
}

module.exports = {
  SOURCES,
  CATEGORIES,
  EVENTS,
  classifyFailure,
  buildEvent,
  emitEvent,
  normalizeSource
};
