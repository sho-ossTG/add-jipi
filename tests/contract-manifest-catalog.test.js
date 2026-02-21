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

function mockRedisFetch() {
  return async function fetch(url, options = {}) {
    const payload = JSON.parse(options.body || "[]");
    const command = Array.isArray(payload) ? payload[0] : [];
    const op = command[0];
    let result = "OK";

    if (op === "PING") result = "PONG";
    if (op === "GET") result = "1";
    if (op === "ZSCORE") result = "1";
    if (op === "ZCARD") result = 1;

    return {
      ok: true,
      async json() {
        return [{ result }];
      }
    };
  };
}

async function request(pathname) {
  process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";

  const originalFetch = global.fetch;
  global.fetch = mockRedisFetch();

  delete require.cache[require.resolve("../serverless")];
  const handler = require("../serverless");

  const req = {
    method: "GET",
    url: pathname,
    headers: { host: "localhost:3000", "x-forwarded-for": "203.0.113.1" },
    socket: { remoteAddress: "203.0.113.1" }
  };
  const res = createResponse();

  try {
    await handler(req, res);
    return {
      statusCode: res.statusCode,
      headers: res.headers,
      body: res.body ? JSON.parse(res.body) : null
    };
  } finally {
    global.fetch = originalFetch;
  }
}

test("GET /manifest.json returns contract-valid manifest", async () => {
  const response = await request("/manifest.json");

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /^application\/json/);
  assert.ok(response.body);
  assert.equal(response.body.id, "org.jipi.onepiece");
  assert.equal(response.body.name, "One Piece (Jipi)");
  assert.ok(Array.isArray(response.body.resources));
  assert.ok(response.body.resources.includes("catalog"));
  assert.ok(Array.isArray(response.body.catalogs));
  assert.equal(response.body.catalogs[0].id, "onepiece_catalog");
  assert.equal(response.body.catalogs[0].name, "One Piece");
});

test("GET supported catalog returns metas with id/type/name", async () => {
  const response = await request("/catalog/series/onepiece_catalog.json");

  assert.equal(response.statusCode, 200);
  assert.ok(response.body);
  assert.ok(Array.isArray(response.body.metas));
  assert.ok(response.body.metas.length > 0);

  for (const meta of response.body.metas) {
    assert.equal(typeof meta.id, "string");
    assert.equal(typeof meta.type, "string");
    assert.equal(typeof meta.name, "string");
    assert.ok(meta.id.length > 0);
    assert.ok(meta.type.length > 0);
    assert.ok(meta.name.length > 0);
  }
});

test("GET unsupported catalog returns empty metas payload", async () => {
  const response = await request("/catalog/series/unsupported_catalog.json");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { metas: [] });
});
