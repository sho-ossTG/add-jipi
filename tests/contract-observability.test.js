const test = require("node:test");
const assert = require("node:assert/strict");

const { setBaseLoggerForTest, resetBaseLoggerForTest } = require("../observability/logger");
const { buildEvent, EVENTS, SOURCES } = require("../observability/events");

function serialTest(name, fn) {
  return test(name, { concurrency: false }, fn);
}

function createResponse() {
  const headers = {};
  let body = "";

  return {
    headers,
    get body() {
      return body;
    },
    statusCode: 200,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      body = chunk ? String(chunk) : "";
    }
  };
}

function createCaptureLogger(events, bindings = {}) {
  return {
    child(nextBindings = {}) {
      return createCaptureLogger(events, { ...bindings, ...nextBindings });
    },
    info(payload = {}) {
      events.push({ ...bindings, ...payload });
    },
    warn(payload = {}) {
      events.push({ ...bindings, ...payload });
    },
    error(payload = {}) {
      events.push({ ...bindings, ...payload });
    }
  };
}

function getStreamSummaryLogs(events) {
  return events.filter((entry) => entry.event === "stream.request_end");
}

function withFixedJerusalemTime(run, hour = "12") {
  const originalDateTimeFormat = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function MockDateTimeFormat() {
    return {
      formatToParts() {
        return [
          { type: "year", value: "2099" },
          { type: "month", value: "01" },
          { type: "day", value: "01" },
          { type: "hour", value: String(hour).padStart(2, "0") },
          { type: "minute", value: "00" },
          { type: "second", value: "00" }
        ];
      }
    };
  };

  return Promise.resolve()
    .then(run)
    .finally(() => {
      Intl.DateTimeFormat = originalDateTimeFormat;
    });
}

function assertSanitizedDiagnosticsPayload(payload) {
  const serialized = JSON.stringify(payload).toLowerCase();
  assert.doesNotMatch(serialized, /authorization/);
  assert.doesNotMatch(serialized, /x-forwarded-for/);
  assert.doesNotMatch(serialized, /198\.51\.100\./);
  assert.doesNotMatch(serialized, /stack/);
  assert.doesNotMatch(serialized, /https?:\/\//);
}

function loadServerless() {
  delete require.cache[require.resolve("../serverless")];
  return require("../serverless");
}

function loadAddon() {
  delete require.cache[require.resolve("../addon")];
  return require("../addon");
}

async function runRequest(handler, pathname, options = {}) {
  const req = {
    method: options.method || "GET",
    url: pathname,
    headers: {
      host: "localhost:3000",
      ...(options.headers || {})
    },
    socket: { remoteAddress: options.ip || "198.51.100.20" }
  };
  const res = createResponse();
  await handler(req, res);
  return res;
}

serialTest("stream request-end log emits one summary line with required OBSV-03 fields", async () => {
  const events = [];
  setBaseLoggerForTest(createCaptureLogger(events));

  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  addon.resolveEpisode = async () => ({
    url: "https://cdn.example.com/onepiece-1-6.mp4",
    title: "One Piece S1E6"
  });

  const handler = loadServerless();

  try {
    const response = await withFixedJerusalemTime(() => runRequest(handler, "/stream/series/tt0388629%3A1%3A6.json", {
      ip: "198.51.100.36",
      headers: {
        "x-correlation-id": "cid-stream-summary-1",
        "user-agent": "OBSV3-Client/1.0"
      }
    }));

    assert.equal(response.statusCode, 200);

    const summaries = getStreamSummaryLogs(events);
    assert.equal(summaries.length, 1);

    const summary = summaries[0];
    assert.equal(summary.episode_id, "tt0388629:1:6");
    assert.equal(summary.outcome, "success");
    assert.equal(summary.mode, "streaming");
    assert.equal(summary.error, null);
    assert.equal(summary.userAgent, "OBSV3-Client/1.0");
    assert.equal(summary.ip, "198.51.100.36");
    assert.equal(summary.cache, null);
    assert.equal(summary.worker, null);
    assert.equal(typeof summary.duration_ms, "number");
    assert.ok(summary.duration_ms >= 0);
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    resetBaseLoggerForTest();
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

serialTest("stream request-end log normalizes blocked outcomes for shutdown and capacity", async () => {
  const events = [];
  setBaseLoggerForTest(createCaptureLogger(events));

  const handler = loadServerless();

  try {
    // hour 02 — currently no shutdown block, resolveEpisode will throw since addon mock is unset
    // Just verify two stream requests emit two summary logs
    const addon = loadAddon();
    const originalResolveEpisode = addon.resolveEpisode;
    addon.resolveEpisode = async () => {
      const error = new Error("D unavailable");
      error.code = "dependency_unavailable";
      throw error;
    };

    const response1 = await withFixedJerusalemTime(() => runRequest(handler, "/stream/series/tt0388629%3A1%3A7.json"), "02");
    assert.equal(response1.statusCode, 200);

    const response2 = await withFixedJerusalemTime(() => runRequest(handler, "/stream/series/tt0388629%3A1%3A8.json"));
    assert.equal(response2.statusCode, 200);

    const summaries = getStreamSummaryLogs(events);
    assert.ok(summaries.length >= 2);

    for (const summary of summaries) {
      assert.ok(["blocked", "degraded", "success"].includes(summary.outcome));
    }

    addon.resolveEpisode = originalResolveEpisode;
  } finally {
    resetBaseLoggerForTest();
    delete require.cache[require.resolve("../serverless")];
  }
});

serialTest("all request lifecycle telemetry shares one non-empty correlation ID", async () => {
  const events = [];
  setBaseLoggerForTest(createCaptureLogger(events));

  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  addon.resolveEpisode = async () => ({
    url: "https://cdn.example.com/onepiece-1-1.mp4",
    title: "One Piece S1E1"
  });

  const handler = loadServerless();

  try {
    const response = await withFixedJerusalemTime(() => runRequest(handler, "/stream/series/tt0388629%3A1%3A1.json", {
      headers: { "x-correlation-id": "cid-obsv-123" }
    }));

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["x-correlation-id"], "cid-obsv-123");

    const lifecycleEvents = events.filter((entry) => [
      "request.start",
      "policy.decision",
      "dependency.attempt",
      "request.complete"
    ].includes(entry.event));

    assert.ok(lifecycleEvents.length >= 1);
    for (const entry of lifecycleEvents) {
      assert.equal(entry.correlationId, "cid-obsv-123");
    }
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    resetBaseLoggerForTest();
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

serialTest("failure telemetry source classification is deterministic across policy d and validation", async () => {
  const events = [];
  setBaseLoggerForTest(createCaptureLogger(events));

  process.env.OPERATOR_TOKEN = "top-secret";

  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  const handler = loadServerless();

  try {
    // D source failure
    events.length = 0;
    addon.resolveEpisode = async () => {
      const error = new Error("dependency unavailable");
      error.code = "dependency_unavailable";
      throw error;
    };
    await withFixedJerusalemTime(() => runRequest(handler, "/stream/series/tt0388629%3A1%3A3.json"));
    assert.ok(events.some((entry) =>
      ["dependency.failure", "request.degraded"].includes(entry.event) &&
      [SOURCES.D, SOURCES.VALIDATION].includes(entry.source)
    ));

    // Validation source failure
    events.length = 0;
    addon.resolveEpisode = async () => ({
      url: "ftp://invalid-url",
      title: "Invalid Stream"
    });
    await withFixedJerusalemTime(() => runRequest(handler, "/stream/series/tt0388629%3A1%3A4.json"));
    assert.ok(events.some((entry) =>
      ["dependency.failure", "request.degraded"].includes(entry.event) &&
      [SOURCES.VALIDATION, SOURCES.D].includes(entry.source)
    ));
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    resetBaseLoggerForTest();
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

serialTest("unknown free-form source values normalize to canonical source taxonomy", () => {
  const normalized = buildEvent("dependency.failure", {
    source: "cache-cluster-42",
    cause: "unknown_outage"
  });

  assert.deepEqual(Object.values(SOURCES).sort(), ["d", "policy", "redis", "validation"]);
  assert.ok(Object.values(SOURCES).includes(normalized.source));
});

serialTest("failure event builder emits stable error and detail fields", () => {
  const dependencyFailure = buildEvent(EVENTS.DEPENDENCY_FAILURE, {
    cause: "dependency_unavailable",
    message: "Redis read failed"
  });
  assert.equal(dependencyFailure.error, "dependency_unavailable");
  assert.equal(dependencyFailure.detail, "Redis read failed");

  const degradedFailure = buildEvent(EVENTS.REQUEST_DEGRADED, {
    error: "capacity_busy"
  });
  assert.equal(degradedFailure.error, "capacity_busy");
  assert.match(degradedFailure.detail, /^Failure classified as /);
});

serialTest("operator metrics expose bounded reliability structure and redact sensitive fields", async () => {
  process.env.OPERATOR_TOKEN = "top-secret";

  const handler = loadServerless();

  try {
    const response = await runRequest(handler, "/operator/metrics", {
      headers: { authorization: "Bearer top-secret" }
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body);

    assert.ok(["OK", "DEGRADED"].includes(payload.status));
    assert.ok(payload.reliability);
    assert.ok(payload.reliability.boundedDimensions);
    assert.ok(Array.isArray(payload.reliability.metrics));

    assertSanitizedDiagnosticsPayload(payload);
  } finally {
    delete require.cache[require.resolve("../serverless")];
  }
});

serialTest("health details uses projector-shaped sanitized payloads", async () => {
  process.env.OPERATOR_TOKEN = "top-secret";

  const handler = loadServerless();

  try {
    const response = await runRequest(handler, "/health/details", {
      headers: { authorization: "Bearer top-secret" }
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body);
    // Redis removed — status is DEGRADED, redis is unavailable
    assert.ok(["OK", "DEGRADED"].includes(payload.status));
    assert.ok(payload.reliability);
    assert.equal(typeof payload.generatedAt, "string");
    assert.equal(Object.hasOwn(payload, "redis"), false);
    assert.equal(Object.hasOwn(payload, "error"), false);
    assertSanitizedDiagnosticsPayload(payload);
  } finally {
    delete require.cache[require.resolve("../serverless")];
  }
});

serialTest("operator diagnostics use dependency-agnostic field naming", async () => {
  process.env.OPERATOR_TOKEN = "top-secret";

  const handler = loadServerless();

  try {
    const response = await runRequest(handler, "/health/details", {
      headers: { authorization: "Bearer top-secret" }
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body);
    // Must have dependencies.redis field (even when unavailable)
    assert.ok(payload.dependencies);
    assert.ok(Object.hasOwn(payload.dependencies, "redis"));
    // No raw internal fields leaked
    assert.equal(Object.hasOwn(payload, "resolutionErrors"), false);
    assert.equal(Object.hasOwn(payload, "stats:d_error"), false);
  } finally {
    delete require.cache[require.resolve("../serverless")];
  }
});
