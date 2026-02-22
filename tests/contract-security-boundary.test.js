const test = require("node:test");
const assert = require("node:assert/strict");

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

function withFixedJerusalemTime(run) {
  const originalDateTimeFormat = Intl.DateTimeFormat;

  Intl.DateTimeFormat = function MockDateTimeFormat() {
    return {
      formatToParts() {
        return [
          { type: "year", value: "2099" },
          { type: "month", value: "01" },
          { type: "day", value: "01" },
          { type: "hour", value: "12" },
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

function createRedisMock(options = {}) {
  const recordedIps = [];
  const {
    quarantineEvents = [
      {
        ip: "198.51.100.22",
        error: "broker timeout stacktrace",
        episodeId: "tt0388629:1:1",
        time: "2099-01-01T12:00:00.000Z"
      }
    ]
  } = options;

  async function fetch(_url, requestOptions = {}) {
    const payload = JSON.parse(requestOptions.body || "[]");
    const command = Array.isArray(payload) ? payload[0] : [];
    const op = command[0];
    const key = command[1];
    let result = "OK";

    if (op === "PING") result = "PONG";
    if (op === "EVAL") {
      const currentIp = command[4];
      recordedIps.push(currentIp);
      result = [1, "admitted:new", "", 1];
    }
    if (op === "GET") {
      if (String(key || "").startsWith("system:reset:")) result = "1";
      else if (String(key || "").startsWith("active:url:")) result = null;
      else if (String(key || "").startsWith("stats:")) result = 0;
      else result = null;
    }
    if (op === "ZSCORE") {
      recordedIps.push(key);
      result = "1";
    }
    if (op === "ZCARD") result = 1;
    if (op === "LRANGE") result = quarantineEvents.map((event) => JSON.stringify(event));

    return {
      ok: true,
      async json() {
        return [{ result }];
      }
    };
  }

  return { fetch, recordedIps };
}

async function request(pathname, options = {}) {
  const {
    method = "GET",
    headers = {},
    redisMock = createRedisMock(),
    resolveEpisode,
    withRedisConfig = true
  } = options;

  if (withRedisConfig) {
    process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
    process.env.KV_REST_API_TOKEN = "token";
  } else {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  }
  process.env.CORS_ALLOW_ORIGINS = "https://allowed.example";

  const originalFetch = global.fetch;
  global.fetch = redisMock.fetch;

  const addon = require("../addon");
  const originalResolveEpisode = addon.resolveEpisode;
  if (resolveEpisode) addon.resolveEpisode = resolveEpisode;

  delete require.cache[require.resolve("../serverless")];
  const handler = require("../serverless");

  const req = {
    method,
    url: pathname,
    headers: {
      host: "localhost:3000",
      "x-forwarded-for": "203.0.113.10",
      ...headers
    },
    socket: { remoteAddress: "198.51.100.77" }
  };
  const res = createResponse();

  try {
    await handler(req, res);
    return {
      statusCode: res.statusCode,
      headers: res.headers,
      body: res.body,
      redisMock
    };
  } finally {
    global.fetch = originalFetch;
    addon.resolveEpisode = originalResolveEpisode;
    delete require.cache[require.resolve("../serverless")];
  }
}

test("operator diagnostics routes deny unauthorized requests", async () => {
  process.env.OPERATOR_TOKEN = "top-secret";

  const response = await request("/quarantine");

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), { error: "operator_token_required" });

  const operatorMetrics = await request("/operator/metrics");
  assert.equal(operatorMetrics.statusCode, 401);
  assert.deepEqual(JSON.parse(operatorMetrics.body), { error: "operator_token_required" });
});

test("operator diagnostics routes allow authorized requests", async () => {
  process.env.OPERATOR_TOKEN = "top-secret";

  const response = await request("/health/details", {
    headers: {
      authorization: "Bearer top-secret"
    }
  });

  assert.equal(response.statusCode, 200);
  const healthPayload = JSON.parse(response.body);
  assert.equal(healthPayload.status, "OK");
  assert.equal(healthPayload.dependencies.redis, "connected");
  assert.ok(healthPayload.reliability);
  assert.equal(typeof healthPayload.generatedAt, "string");
  assert.equal(Object.hasOwn(healthPayload, "redis"), false);
  assert.equal(Object.hasOwn(healthPayload, "error"), false);

  const healthSerialized = JSON.stringify(healthPayload).toLowerCase();
  assert.doesNotMatch(healthSerialized, /authorization/);
  assert.doesNotMatch(healthSerialized, /x-forwarded-for/);
  assert.doesNotMatch(healthSerialized, /198\.51\.100\./);
  assert.doesNotMatch(healthSerialized, /stack/);
  assert.doesNotMatch(healthSerialized, /https?:\/\//);

  const metricsResponse = await request("/operator/metrics", {
    headers: {
      authorization: "Bearer top-secret"
    }
  });

  assert.equal(metricsResponse.statusCode, 200);

  const metricsPayload = JSON.parse(metricsResponse.body);
  assert.equal(metricsPayload.status, "OK");
  assert.equal(metricsPayload.dependencies.redis, "connected");
  assert.ok(metricsPayload.reliability);

  const serialized = JSON.stringify(metricsPayload).toLowerCase();
  assert.doesNotMatch(serialized, /authorization/);
  assert.doesNotMatch(serialized, /x-forwarded-for/);
  assert.doesNotMatch(serialized, /198\.51\.100\./);
  assert.doesNotMatch(serialized, /stack/);
  assert.doesNotMatch(serialized, /https?:\/\//);
});

test("trusted attribution ignores spoofed forwarded header", async () => {
  process.env.OPERATOR_TOKEN = "top-secret";

  await withFixedJerusalemTime(async () => {
    const redisMock = createRedisMock();
    await request("/stream/series/tt0388629%3A1%3A1.json", {
      redisMock,
      resolveEpisode: async () => ({
        url: "https://cdn.example.com/onepiece-1-1.mp4",
        title: "One Piece S1E1"
      })
    });

    assert.ok(redisMock.recordedIps.length > 0);
    assert.ok(!redisMock.recordedIps.includes("203.0.113.10"));
  });
});

test("authorized quarantine output and public errors are sanitized", async () => {
  process.env.OPERATOR_TOKEN = "top-secret";

  const quarantineResponse = await request("/quarantine", {
    headers: { authorization: "Bearer top-secret" }
  });
  assert.equal(quarantineResponse.statusCode, 200);
  assert.match(quarantineResponse.body, /\[redacted\]/);
  assert.match(quarantineResponse.body, /internal_error/);
  assert.doesNotMatch(quarantineResponse.body, /198\.51\.100\.22/);
  assert.doesNotMatch(quarantineResponse.body, /broker timeout stacktrace/);

  const publicFailure = await request("/manifest.json", { withRedisConfig: false });
  assert.equal(publicFailure.statusCode, 503);
  assert.deepEqual(JSON.parse(publicFailure.body), { error: "service_unavailable" });
});
