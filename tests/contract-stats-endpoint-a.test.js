const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createMockRedisFetch,
  loadServerless,
  requestWithHandler,
  setRedisEnv
} = require("./helpers/runtime-fixtures");

async function request(handler, pathname, options = {}) {
  return requestWithHandler(handler, pathname, {
    method: options.method || "GET",
    ip: options.ip || "203.0.113.41",
    headers: {
      "x-forwarded-for": options.ip || "203.0.113.41",
      ...(options.headers || {})
    }
  });
}

function withServerA(run) {
  return async () => {
    setRedisEnv();
    const originalFetch = global.fetch;
    global.fetch = createMockRedisFetch("allow");
    const handler = loadServerless();

    try {
      await run(handler);
    } finally {
      global.fetch = originalFetch;
      delete require.cache[require.resolve("../serverless")];
    }
  };
}

test("GET /api/stats returns TELE-03 shape for server A", withServerA(async (handler) => {
  await request(handler, "/manifest.json");
  const response = await request(handler, "/api/stats");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(Object.keys(response.body).sort(), ["error_count", "hour", "request_count", "server"]);
  assert.equal(response.body.server, "A");
  assert.equal(typeof response.body.request_count, "number");
  assert.equal(typeof response.body.error_count, "number");
}));

test("GET /api/stats returns UTC hour in YYYY-MM-DDTHH:00:00Z format", withServerA(async (handler) => {
  const response = await request(handler, "/api/stats");

  assert.equal(response.statusCode, 200);
  assert.match(response.body.hour, /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/);
}));

test("GET /api/stats reflects in-process request/error counters", withServerA(async (handler) => {
  await request(handler, "/manifest.json");
  await request(handler, "/not-found");

  const response = await request(handler, "/api/stats");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.request_count, 2);
  assert.equal(response.body.error_count, 1);
}));

test("non-GET /api/stats returns 405 with JSON error payload", withServerA(async (handler) => {
  const response = await request(handler, "/api/stats", { method: "POST" });

  assert.equal(response.statusCode, 405);
  assert.deepEqual(Object.keys(response.body).sort(), ["detail", "error"]);
  assert.equal(response.body.error, "method_not_allowed");
  assert.equal(response.body.detail, "Use GET for /api/stats.");
}));
