const { AsyncLocalStorage } = require("node:async_hooks");
const { randomUUID } = require("node:crypto");

const HEADER_NAMES = ["x-correlation-id", "X-Correlation-Id"];
const requestContext = new AsyncLocalStorage();

function normalizeCorrelationId(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function extractCorrelationId(req) {
  const headers = (req && req.headers) || {};
  for (const headerName of HEADER_NAMES) {
    const candidate = normalizeCorrelationId(headers[headerName]);
    if (candidate) return candidate;
  }
  return randomUUID();
}

function withRequestContext(req, run) {
  const correlationId = extractCorrelationId(req);
  const store = { correlationId };
  return requestContext.run(store, () => Promise.resolve().then(run));
}

function getRequestContext() {
  return requestContext.getStore() || { correlationId: "" };
}

function getCorrelationId() {
  const store = requestContext.getStore();
  if (store && store.correlationId) {
    return store.correlationId;
  }
  return "";
}

function bindResponseCorrelationId(res) {
  if (!res || typeof res.setHeader !== "function") return "";
  const correlationId = getCorrelationId();
  if (correlationId) {
    res.setHeader("X-Correlation-Id", correlationId);
  }
  return correlationId;
}

module.exports = {
  withRequestContext,
  getRequestContext,
  getCorrelationId,
  bindResponseCorrelationId,
  extractCorrelationId
};
