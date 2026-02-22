const test = require("node:test");
const assert = require("node:assert/strict");

const { setBaseLoggerForTest, resetBaseLoggerForTest } = require("../observability/logger");
const { buildEvent, SOURCES } = require("../observability/events");

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

function createRedisRuntime() {
  const state = {
    strings: new Map()
  };

  async function fetch(_url, options = {}) {
    const payload = JSON.parse(options.body || "[]");
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
      result = [1, "admitted:new", "", 1];
    }

    if (op === "INCR") {
      const next = Number(state.strings.get(key) || 0) + 1;
      state.strings.set(key, String(next));
      result = next;
    }

    if (op === "LPUSH" || op === "LTRIM") {
      result = "OK";
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

test("all request lifecycle telemetry shares one non-empty correlation ID", async () => {
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

    assert.ok(lifecycleEvents.length >= 4);
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

test("failure telemetry source classification is deterministic across policy redis broker and validation", async () => {
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
    await withFixedJerusalemTime(() => runRequest(handler, "/stream/series/tt0388629%3A1%3A2.json"), "02");
    assert.ok(events.some((entry) => entry.event === "policy.decision" && entry.source === SOURCES.POLICY));

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
      const error = new Error("broker unavailable");
      error.code = "broker_http_error";
      throw error;
    };
    await withFixedJerusalemTime(() => runRequest(handler, "/stream/series/tt0388629%3A1%3A3.json"));
    assert.ok(events.some((entry) => entry.event === "dependency.failure" && entry.source === SOURCES.BROKER));

    events.length = 0;
    addon.resolveEpisode = async () => ({
      url: "ftp://invalid-url",
      title: "Invalid Stream"
    });
    await withFixedJerusalemTime(() => runRequest(handler, "/stream/series/tt0388629%3A1%3A4.json"));
    assert.ok(events.some((entry) => entry.event === "dependency.failure" && entry.source === SOURCES.VALIDATION));
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    global.fetch = originalFetch;
    resetBaseLoggerForTest();
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

test("unknown free-form source values normalize to canonical source taxonomy", () => {
  const normalized = buildEvent("dependency.failure", {
    source: "cache-cluster-42",
    cause: "unknown_outage"
  });

  assert.deepEqual(Object.values(SOURCES).sort(), ["broker", "policy", "redis", "validation"]);
  assert.ok(Object.values(SOURCES).includes(normalized.source));
});
