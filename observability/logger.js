const { getCorrelationId } = require("./context");

const REDACT_PATHS = [
  "headers.authorization",
  "headers.cookie",
  "headers.x-operator-token",
  "request.headers.authorization",
  "request.headers.cookie",
  "request.headers.x-operator-token",
  "token",
  "accessToken",
  "refreshToken"
];

let baseLogger;

function createFallbackLogger(bindings = {}) {
  const next = {
    child(childBindings = {}) {
      return createFallbackLogger({ ...bindings, ...childBindings });
    },
    info(payload = {}) {
      const event = { level: "info", ...bindings, ...payload };
      console.log(JSON.stringify(event));
    },
    warn(payload = {}) {
      const event = { level: "warn", ...bindings, ...payload };
      console.warn(JSON.stringify(event));
    },
    error(payload = {}) {
      const event = { level: "error", ...bindings, ...payload };
      console.error(JSON.stringify(event));
    }
  };
  return next;
}

function createBaseLogger() {
  try {
    const pino = require("pino");
    return pino({
      level: process.env.LOG_LEVEL || "info",
      redact: {
        paths: REDACT_PATHS,
        censor: "[redacted]"
      },
      base: null,
      messageKey: "message"
    });
  } catch {
    return createFallbackLogger();
  }
}

function getBaseLogger() {
  if (!baseLogger) {
    baseLogger = createBaseLogger();
  }
  return baseLogger;
}

function getLogger(bindings = {}) {
  const correlationId = getCorrelationId();
  const contextBindings = correlationId ? { correlationId } : {};
  return getBaseLogger().child({ ...contextBindings, ...bindings });
}

function setBaseLoggerForTest(logger) {
  baseLogger = logger;
}

function resetBaseLoggerForTest() {
  baseLogger = undefined;
}

module.exports = {
  REDACT_PATHS,
  getBaseLogger,
  getLogger,
  setBaseLoggerForTest,
  resetBaseLoggerForTest
};
