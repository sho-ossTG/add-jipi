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

function createRedisRuntime(options = {}) {
  const state = {
    strings: new Map(),
    hashes: new Map()
  };

  async function fetch(_url, requestOptions = {}) {
    const payload = JSON.parse(requestOptions.body || "[]");
    const command = Array.isArray(payload) ? payload[0] : [];
    const op = String(command[0] || "").toUpperCase();
    const key = String(command[1] || "");
    let result = "OK";

    if (op === "GET") {
      result = state.strings.has(key) ? state.strings.get(key) : null;
      if (key.startsWith("system:reset:")) result = "1";
    }

    if (op === "SET") {
      state.strings.set(key, String(command[2] || ""));
      result = "OK";
    }

    if (op === "EVAL") {
      result = options.sessionGateResult || [1, "admitted:new", "", 1];
    }

    if (op === "INCR") {
      const next = Number(state.strings.get(key) || 0) + 1;
      state.strings.set(key, String(next));
      result = next;
    }

    if (op === "HINCRBY") {
      const field = String(command[2] || "");
      const amount = Number(command[3] || 0);
      const hash = state.hashes.get(key) || new Map();
      const next = Number(hash.get(field) || 0) + amount;
      hash.set(field, String(next));
      state.hashes.set(key, hash);
      result = next;
    }

    if (op === "HSET") {
      const hash = state.hashes.get(key) || new Map();
      hash.set(String(command[2] || ""), String(command[3] || ""));
      state.hashes.set(key, hash);
      result = 1;
    }

    if (op === "HSETNX") {
      const hash = state.hashes.get(key) || new Map();
      const field = String(command[2] || "");
      if (hash.has(field)) {
        result = 0;
      } else {
        hash.set(field, String(command[3] || ""));
        state.hashes.set(key, hash);
        result = 1;
      }
    }

    if (op === "HGETALL") {
      const hash = state.hashes.get(key) || new Map();
      result = Array.from(hash.entries()).flat();
    }

    if (op === "LPUSH" || op === "LTRIM") {
      result = "OK";
    }

    if (op === "PING" && options.failPing) {
      return {
        ok: false,
        status: 503,
        async json() {
          return [{ error: "ping_failed" }];
        }
      };
    }

    if (op === "PING") {
      result = "PONG";
    }

    return {
      ok: true,
      async json() {
        return [{ result }];
      }
    };
  }

  return { fetch };
}

serialTest("stream request-end log emits one summary line with required OBSV-03 fields", async () => {
  process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";

  const events = [];
  setBaseLoggerForTest(createCaptureLogger(events));

  const runtime = createRedisRuntime();
  const originalFetch = global.fetch;
  global.fetch = runtime.fetch;

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
    global.fetch = originalFetch;
    resetBaseLoggerForTest();
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

serialTest("stream request-end log normalizes blocked outcomes for shutdown and capacity", async () => {
  process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";

  const events = [];
  setBaseLoggerForTest(createCaptureLogger(events));

  const shutdownRuntime = createRedisRuntime();
  const originalFetch = global.fetch;
  global.fetch = shutdownRuntime.fetch;
  const handler = loadServerless();

  try {
    const shutdownResponse = await withFixedJerusalemTime(() => runRequest(handler, "/stream/series/tt0388629%3A1%3A7.json"), "02");
    assert.equal(shutdownResponse.statusCode, 200);

    const capacityRuntime = createRedisRuntime({
      sessionGateResult: [0, "blocked:slot_taken", "", 2]
    });
    global.fetch = capacityRuntime.fetch;

    const capacityResponse = await withFixedJerusalemTime(() => runRequest(handler, "/stream/series/tt0388629%3A1%3A8.json"));
    assert.equal(capacityResponse.statusCode, 200);

    const summaries = getStreamSummaryLogs(events);
    assert.ok(summaries.length >= 2);

    const degradedEvents = events.filter((entry) => entry.event === "request.degraded");
    assert.equal(degradedEvents.length, 2);
    for (const degradedEvent of degradedEvents) {
      assert.equal(typeof degradedEvent.error, "string");
      assert.ok(degradedEvent.error.length > 0);
      assert.equal(typeof degradedEvent.detail, "string");
      assert.ok(degradedEvent.detail.length > 0);
    }

    assert.equal(summaries[0].episode_id, "tt0388629:1:7");
    assert.ok(["blocked", "degraded"].includes(summaries[0].outcome));
    assert.equal(typeof summaries[0].error, "string");
    assert.ok(summaries[0].error.length > 0);

    assert.equal(summaries[1].episode_id, "tt0388629:1:8");
    assert.ok(["blocked", "degraded"].includes(summaries[1].outcome));
    assert.equal(typeof summaries[1].error, "string");
    assert.ok(summaries[1].error.length > 0);
  } finally {
    global.fetch = originalFetch;
    resetBaseLoggerForTest();
    delete require.cache[require.resolve("../serverless")];
  }
});

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

serialTest("all request lifecycle telemetry shares one non-empty correlation ID", async () => {
  process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";

  const events = [];
  setBaseLoggerForTest(createCaptureLogger(events));

  const runtime = createRedisRuntime();
  const originalFetch = global.fetch;
  global.fetch = runtime.fetch;

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
    global.fetch = originalFetch;
    resetBaseLoggerForTest();
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

serialTest("failure telemetry source classification is deterministic across policy redis d and validation", async () => {
  const events = [];
  setBaseLoggerForTest(createCaptureLogger(events));

  const runtime = createRedisRuntime();
  const originalFetch = global.fetch;
  global.fetch = runtime.fetch;

  process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";
  process.env.OPERATOR_TOKEN = "top-secret";

  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  const handler = loadServerless();

  try {
    const policyResponse = await withFixedJerusalemTime(
      () => runRequest(handler, "/stream/series/tt0388629%3A1%3A2.json"),
      "02"
    );
    assert.equal(policyResponse.statusCode, 200);

    events.length = 0;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    await runRequest(handler, "/health/details", {
      headers: { authorization: "Bearer top-secret" }
    });
    assert.ok(events.some((entry) => entry.event === "dependency.failure" && entry.source === SOURCES.REDIS));

    events.length = 0;
    process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
    process.env.KV_REST_API_TOKEN = "token";
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
    global.fetch = originalFetch;
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

serialTest("operator metrics expose bounded reliability labels and redact sensitive fields", async () => {
  process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";
  process.env.OPERATOR_TOKEN = "top-secret";

  const runtime = createRedisRuntime();
  const originalFetch = global.fetch;
  global.fetch = runtime.fetch;

  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  addon.resolveEpisode = async () => ({
    url: "https://cdn.example.com/onepiece-1-5.mp4",
    title: "One Piece S1E5"
  });

  const handler = loadServerless();

  try {
    await withFixedJerusalemTime(() => runRequest(handler, "/stream/series/tt0388629%3A1%3A5.json"));

    const response = await runRequest(handler, "/operator/metrics", {
      headers: { authorization: "Bearer top-secret" }
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body);

    assert.equal(payload.status, "OK");
    assert.equal(payload.dependencies.redis, "connected");
    assert.ok(Array.isArray(payload.reliability.metrics));

    for (const metric of payload.reliability.metrics) {
      assert.ok(payload.reliability.boundedDimensions.source.includes(metric.labels.source));
      assert.ok(payload.reliability.boundedDimensions.cause.includes(metric.labels.cause));
      assert.ok(payload.reliability.boundedDimensions.routeClass.includes(metric.labels.routeClass));
      assert.ok(payload.reliability.boundedDimensions.result.includes(metric.labels.result));
      assert.match(String(metric.firstSeen || ""), /^\d{4}-\d{2}-\d{2}T/);
      assert.match(String(metric.lastSeen || ""), /^\d{4}-\d{2}-\d{2}T/);
    }

    assertSanitizedDiagnosticsPayload(payload);
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

serialTest("health details uses projector-shaped sanitized payloads for success and degraded branches", async () => {
  process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";
  process.env.OPERATOR_TOKEN = "top-secret";

  const originalFetch = global.fetch;
  const successRuntime = createRedisRuntime();
  global.fetch = successRuntime.fetch;

  const handler = loadServerless();

  try {
    const successResponse = await runRequest(handler, "/health/details", {
      headers: { authorization: "Bearer top-secret" }
    });

    assert.equal(successResponse.statusCode, 200);
    const successPayload = JSON.parse(successResponse.body);
    assert.equal(successPayload.status, "OK");
    assert.equal(successPayload.dependencies.redis, "connected");
    assert.ok(successPayload.reliability);
    assert.equal(typeof successPayload.generatedAt, "string");
    assert.equal(Object.hasOwn(successPayload, "redis"), false);
    assert.equal(Object.hasOwn(successPayload, "error"), false);
    assertSanitizedDiagnosticsPayload(successPayload);

    const degradedRuntime = createRedisRuntime({ failPing: true });
    global.fetch = degradedRuntime.fetch;
    const degradedResponse = await runRequest(handler, "/health/details", {
      headers: { authorization: "Bearer top-secret" }
    });

    assert.equal(degradedResponse.statusCode, 503);
    const degradedPayload = JSON.parse(degradedResponse.body);
    assert.equal(degradedPayload.status, "DEGRADED");
    assert.equal(degradedPayload.dependencies.redis, "unavailable");
    assert.ok(degradedPayload.reliability);
    assert.equal(typeof degradedPayload.generatedAt, "string");
    assert.equal(Object.hasOwn(degradedPayload, "redis"), false);
    assert.equal(Object.hasOwn(degradedPayload, "error"), false);
    assertSanitizedDiagnosticsPayload(degradedPayload);
  } finally {
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../serverless")];
  }
});
