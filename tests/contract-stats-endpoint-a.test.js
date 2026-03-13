const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createMockRedisFetch,
  loadServerless,
  requestWithHandler,
  setRedisEnv
} = require("./helpers/runtime-fixtures");
const { toHourBucket } = require("../modules/analytics/hourly-tracker");

function createStatsRedisFetch(fields = {}) {
  const baseFetch = createMockRedisFetch("allow");
  const source = {
    ...fields
  };

  return async function statsFetch(url, options = {}) {
    const payload = JSON.parse(options.body || "[]");
    const command = Array.isArray(payload) ? payload[0] : [];
    const operation = String(command[0] || "").toUpperCase();
    const key = String(command[1] || "");
    const field = String(command[2] || "");

    if (operation === "HGET" && key === "analytics:hourly") {
      const result = Object.prototype.hasOwnProperty.call(source, field)
        ? source[field]
        : null;
      return {
        ok: true,
        async json() {
          return [{ result }];
        }
      };
    }

    return baseFetch(url, options);
  };
}

async function requestStats(pathname, options = {}) {
  const {
    method = "GET",
    fetchImpl = createStatsRedisFetch(),
    headers = {}
  } = options;

  setRedisEnv();
  const originalFetch = global.fetch;
  global.fetch = fetchImpl;

  const handler = loadServerless();

  try {
    return await requestWithHandler(handler, pathname, {
      method,
      ip: "203.0.113.41",
      headers: {
        "x-forwarded-for": "203.0.113.41",
        ...headers
      }
    });
  } finally {
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../serverless")];
  }
}

test("GET /api/stats returns TELE-03 shape for server A", async () => {
  const bucket = toHourBucket();
  const response = await requestStats("/api/stats", {
    fetchImpl: createStatsRedisFetch({
      [`${bucket}|requests.total|count`]: "7",
      [`${bucket}|policy.blocked|count`]: "2"
    })
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(Object.keys(response.body).sort(), ["error_count", "hour", "request_count", "server"]);
  assert.equal(response.body.server, "A");
  assert.equal(response.body.request_count, 7);
  assert.equal(response.body.error_count, 2);
});

test("GET /api/stats returns UTC hour in YYYY-MM-DDTHH:00:00Z format", async () => {
  const response = await requestStats("/api/stats");

  assert.equal(response.statusCode, 200);
  assert.match(response.body.hour, /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/);
});

test("GET /api/stats defaults missing Redis counters to numeric zeros", async () => {
  const response = await requestStats("/api/stats", {
    fetchImpl: createStatsRedisFetch({})
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.request_count, 0);
  assert.equal(response.body.error_count, 0);
});

test("non-GET /api/stats returns 405 with JSON error payload", async () => {
  const response = await requestStats("/api/stats", {
    method: "POST"
  });

  assert.equal(response.statusCode, 405);
  assert.deepEqual(response.body, { error: "method_not_allowed" });
});
