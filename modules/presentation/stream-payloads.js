function formatStream(title, url) {
  return {
    name: "Jipi",
    title,
    url,
    behaviorHints: {
      notWebReady: true
    }
  };
}

function resolveFailureClassification(causeInput, injected) {
  if (typeof injected.classifyFailure !== "function") {
    if (typeof causeInput === "string") {
      return { source: "policy", cause: causeInput };
    }
    return { source: "d", cause: "dependency_unavailable" };
  }

  if (typeof causeInput === "string") {
    return injected.classifyFailure({ reason: causeInput });
  }

  return injected.classifyFailure({ error: causeInput });
}

function buildDegradedStreamPayload(causeInput, injected = {}) {
  const degradedPolicy = injected.degradedPolicy || {};
  const fallbackVideoUrl = String(injected.fallbackVideoUrl || "");
  const classification = resolveFailureClassification(causeInput, injected);
  const policy = degradedPolicy[classification.cause] || degradedPolicy.dependency_unavailable || {
    mode: "empty",
    message: "Temporary stream fallback"
  };

  if (policy.mode === "empty") {
    return {
      streams: [],
      notice: policy.message
    };
  }

  return {
    streams: [formatStream(`⚠️ ${policy.message}`, fallbackVideoUrl)]
  };
}

function applyWebsiteHealthNotificationStub(basePayload, classification, injected = {}) {
  const stubConfig = injected.stubs && injected.stubs.websiteHealthNotification;
  const STUB_ENABLED = false;

  if (!STUB_ENABLED || !stubConfig || !stubConfig.enabled) {
    return basePayload;
  }

  const route = String(stubConfig.route || "/stream/...");
  const statusPath = String(stubConfig.statusPath || "/health");
  const healthMessage = "Website health notice: streaming is in degraded mode while upstream checks recover.";
  const routeMessage = `Affected route: ${route}.`;

  return {
    ...basePayload,
    notice: [healthMessage, routeMessage, `Live status endpoint: ${statusPath}.`].join(" "),
    healthNotification: {
      state: classification.cause || "dependency_unavailable",
      title: "Stream temporarily degraded",
      description: healthMessage,
      statusPath
    }
  };
}

function sendDegradedStream(req, res, causeInput, injected = {}) {
  if (typeof injected.sendJson !== "function") {
    throw new Error("sendDegradedStream requires injected.sendJson");
  }

  const classification = resolveFailureClassification(causeInput, injected);
  if (typeof injected.emitTelemetry === "function") {
    const route = (req && req.url) || "";
    const method = (req && req.method) || "GET";
    const detail = causeInput && typeof causeInput === "object"
      ? String(causeInput.message || causeInput.code || "unknown error")
      : String(causeInput || classification.cause || "unknown reason");
    injected.emitTelemetry(injected.events && injected.events.REQUEST_DEGRADED, {
      ...classification,
      route,
      method,
      message: `Server A returned a degraded stream response for ${method} ${route} because ${classification.cause || "the request"} was triggered: ${detail}`
    });
  }

  const basePayload = buildDegradedStreamPayload(causeInput, injected);
  const payload = applyWebsiteHealthNotificationStub(basePayload, classification, injected);
  injected.sendJson(req, res, 200, payload);
  return payload;
}

module.exports = {
  formatStream,
  buildDegradedStreamPayload,
  sendDegradedStream
};
