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
    return { source: "broker", cause: "dependency_unavailable" };
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

function sendDegradedStream(req, res, causeInput, injected = {}) {
  if (typeof injected.sendJson !== "function") {
    throw new Error("sendDegradedStream requires injected.sendJson");
  }

  const classification = resolveFailureClassification(causeInput, injected);
  if (typeof injected.emitTelemetry === "function") {
    injected.emitTelemetry(injected.events && injected.events.REQUEST_DEGRADED, {
      ...classification,
      route: (req && req.url) || "",
      method: (req && req.method) || "GET"
    });
  }

  const payload = buildDegradedStreamPayload(causeInput, injected);
  injected.sendJson(req, res, 200, payload);
  return payload;
}

module.exports = {
  formatStream,
  buildDegradedStreamPayload,
  sendDegradedStream
};
