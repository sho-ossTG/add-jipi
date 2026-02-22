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
    getHeader(name) {
      return headers[String(name).toLowerCase()];
    },
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      body = chunk ? String(chunk) : "";
    }
  };
}

function mockRedisFetch() {
  return async function fetch(_url, options = {}) {
    const payload = JSON.parse(options.body || "[]");
    const command = Array.isArray(payload) ? payload[0] : [];
    const op = command[0];
    let result = "PONG";

    if (op === "EVAL") {
      result = [1, "admitted:new", "", 1];
    }

    return {
      ok: true,
      async json() {
        return [{ result }];
      }
    };
  };
}

async function request(method, pathname, headers = {}) {
  process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";
  process.env.CORS_ALLOW_ORIGINS = "https://allowed.example,https://stremio.example";
  process.env.CORS_ALLOW_HEADERS = "Content-Type,Authorization,X-Operator-Token";
  process.env.CORS_ALLOW_METHODS = "GET,OPTIONS";

  const originalFetch = global.fetch;
  global.fetch = mockRedisFetch();

  delete require.cache[require.resolve("../serverless")];
  const handler = require("../serverless");

  const req = {
    method,
    url: pathname,
    headers: {
      host: "localhost:3000",
      ...headers
    },
    socket: { remoteAddress: "203.0.113.1" }
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
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../serverless")];
  }
}

test("preflight from allowed origin returns explicit methods and headers", async () => {
  const response = await request("OPTIONS", "/health", {
    origin: "https://allowed.example",
    "access-control-request-method": "GET",
    "access-control-request-headers": "Authorization,X-Operator-Token"
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["access-control-allow-origin"], "https://allowed.example");
  assert.equal(response.headers["access-control-allow-methods"], "GET,OPTIONS");
  assert.equal(response.headers["access-control-allow-headers"], "content-type,authorization,x-operator-token");
  assert.equal(response.headers.vary, "Origin");
});

test("preflight from disallowed origin does not receive CORS grant", async () => {
  const response = await request("OPTIONS", "/health", {
    origin: "https://blocked.example",
    "access-control-request-method": "GET",
    "access-control-request-headers": "Authorization"
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  assert.equal(response.headers["access-control-allow-methods"], undefined);
});

test("preflight with disallowed requested method is rejected", async () => {
  const response = await request("OPTIONS", "/health", {
    origin: "https://allowed.example",
    "access-control-request-method": "POST",
    "access-control-request-headers": "Authorization"
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.headers["access-control-allow-origin"], "https://allowed.example");
  assert.equal(response.headers.vary, "Origin");
  assert.deepEqual(JSON.parse(response.body), { error: "cors_method_not_allowed" });
});

test("allowed-origin GET response includes expected CORS headers", async () => {
  const response = await request("GET", "/health", {
    origin: "https://stremio.example"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["access-control-allow-origin"], "https://stremio.example");
  assert.equal(response.headers.vary, "Origin");
  assert.deepEqual(JSON.parse(response.body), { status: "OK" });
});

test("non-browser request without Origin remains protocol-safe", async () => {
  const response = await request("GET", "/health");

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  assert.match(response.headers["content-type"], /^application\/json/);
  assert.deepEqual(JSON.parse(response.body), { status: "OK" });
});
