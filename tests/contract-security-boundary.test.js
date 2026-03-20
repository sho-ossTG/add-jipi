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

async function request(pathname, options = {}) {
  const {
    method = "GET",
    headers = {},
    resolveEpisode
  } = options;

  process.env.CORS_ALLOW_ORIGINS = "https://allowed.example";

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
      body: res.body
    };
  } finally {
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

  const logsPendingRead = await request("/operator/logs/pending?day=2099-01-01");
  assert.equal(logsPendingRead.statusCode, 401);
  assert.deepEqual(JSON.parse(logsPendingRead.body), { error: "operator_token_required" });

  const logsPendingDelete = await request("/operator/logs/pending?day=2099-01-01", {
    method: "DELETE"
  });
  assert.equal(logsPendingDelete.statusCode, 401);
  assert.deepEqual(JSON.parse(logsPendingDelete.body), { error: "operator_token_required" });
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
  // Redis is removed — status is DEGRADED and redis dependency is unavailable
  assert.ok(["OK", "DEGRADED"].includes(healthPayload.status));
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
  assert.ok(["OK", "DEGRADED"].includes(metricsPayload.status));
  assert.ok(metricsPayload.reliability);

  const serialized = JSON.stringify(metricsPayload).toLowerCase();
  assert.doesNotMatch(serialized, /authorization/);
  assert.doesNotMatch(serialized, /x-forwarded-for/);
  assert.doesNotMatch(serialized, /198\.51\.100\./);
  assert.doesNotMatch(serialized, /stack/);
  assert.doesNotMatch(serialized, /https?:\/\//);

  const analyticsResponse = await request("/operator/analytics", {
    headers: {
      authorization: "Bearer top-secret"
    }
  });
  assert.equal(analyticsResponse.statusCode, 501);

  const rollupResponse = await request("/operator/rollup/nightly?day=2099-01-01", {
    headers: {
      authorization: "Bearer top-secret"
    }
  });
  assert.equal(rollupResponse.statusCode, 501);

  const logsPendingRead = await request("/operator/logs/pending?day=2099-01-01", {
    headers: {
      authorization: "Bearer top-secret"
    }
  });
  assert.equal(logsPendingRead.statusCode, 501);

  const logsPendingDelete = await request("/operator/logs/pending?day=2099-01-01", {
    method: "DELETE",
    headers: {
      authorization: "Bearer top-secret"
    }
  });
  assert.equal(logsPendingDelete.statusCode, 501);
});

test("trusted attribution ignores spoofed forwarded header", async () => {
  process.env.OPERATOR_TOKEN = "top-secret";

  await withFixedJerusalemTime(async () => {
    const ipsSeen = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options = {}) => {
      if (String(url || "").includes("/api/ua")) {
        return {
          ok: true,
          status: 202,
          async json() { return {}; }
        };
      }
      if (originalFetch) return originalFetch(url, options);
      throw new Error("unexpected fetch: " + url);
    };

    const addon = require("../addon");
    const originalResolveEpisode = addon.resolveEpisode;
    addon.resolveEpisode = async (_episodeId, opts = {}) => {
      if (opts && opts.clientIp) ipsSeen.push(opts.clientIp);
      return {
        url: "https://cdn.example.com/onepiece-1-1.mp4",
        title: "One Piece S1E1"
      };
    };

    delete require.cache[require.resolve("../serverless")];
    const handler = require("../serverless");

    const req = {
      method: "GET",
      url: "/stream/series/tt0388629%3A1%3A1.json",
      headers: {
        host: "localhost:3000",
        "x-forwarded-for": "203.0.113.10"
      },
      socket: { remoteAddress: "198.51.100.77" }
    };
    const res = createResponse();

    try {
      await handler(req, res);
      // The spoofed x-forwarded-for IP (203.0.113.10) should NOT be trusted
      // since TRUST_PROXY defaults to loopback/linklocal/uniquelocal only
      assert.ok(!ipsSeen.includes("203.0.113.10"), "spoofed forwarded IP should not be trusted");
    } finally {
      global.fetch = originalFetch;
      addon.resolveEpisode = originalResolveEpisode;
      delete require.cache[require.resolve("../serverless")];
    }
  });
});

test("public manifest is accessible without credentials", async () => {
  const publicManifest = await request("/manifest.json");
  assert.equal(publicManifest.statusCode, 200);
});

test("stream request succeeds without any Redis env vars set", async () => {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const streamResponse = await request("/stream/series/tt0388629%3A1%3A1.json", {
    resolveEpisode: async () => ({
      url: "https://cdn.example.com/onepiece-1-1.mp4",
      title: "One Piece S1E1"
    })
  });
  assert.equal(streamResponse.statusCode, 200);
  const streamPayload = JSON.parse(streamResponse.body);
  assert.ok(Array.isArray(streamPayload.streams));
  assert.equal(streamPayload.streams.length, 1);
  assert.match(streamPayload.streams[0].url, /^https:\/\//);
});
