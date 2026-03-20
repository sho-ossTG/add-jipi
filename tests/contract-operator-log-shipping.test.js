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
      headers[String(name).toLowerCase()] = value;
    },
    end(chunk) {
      body = chunk ? String(chunk) : "";
    }
  };
}

function loadServerless() {
  delete require.cache[require.resolve("../serverless")];
  return require("../serverless");
}

async function request(pathname, options = {}) {
  const {
    method = "GET",
    headers = {
      authorization: "Bearer top-secret"
    }
  } = options;

  process.env.OPERATOR_TOKEN = "top-secret";

  const handler = loadServerless();
  const req = {
    method,
    url: pathname,
    headers: {
      host: "localhost:3000",
      ...headers
    },
    socket: { remoteAddress: "198.51.100.40" }
  };
  const res = createResponse();

  try {
    await handler(req, res);
    let body = null;
    if (res.body) {
      try {
        body = JSON.parse(res.body);
      } catch {
        body = null;
      }
    }
    return {
      statusCode: res.statusCode,
      body,
      rawBody: res.body
    };
  } finally {
    delete require.cache[require.resolve("../serverless")];
  }
}

test("GET /operator/logs/pending returns 501 not_supported — Redis removed", async () => {
  const response = await request("/operator/logs/pending?day=2099-01-01");

  assert.equal(response.statusCode, 501);
  assert.deepEqual(response.body, { error: "not_supported" });
});

test("DELETE /operator/logs/pending returns 501 not_supported — Redis removed", async () => {
  const response = await request("/operator/logs/pending?day=2099-01-01", {
    method: "DELETE"
  });

  assert.equal(response.statusCode, 501);
  assert.deepEqual(response.body, { error: "not_supported" });
});

test("PATCH /operator/logs/pending returns 405 method_not_allowed", async () => {
  const response = await request("/operator/logs/pending?day=2099-01-01", {
    method: "PATCH"
  });

  assert.equal(response.statusCode, 405);
  assert.deepEqual(response.body, { error: "method_not_allowed" });
});

test("GET /operator/logs/pending returns 401 when unauthorized", async () => {
  const response = await request("/operator/logs/pending?day=2099-01-01", {
    headers: {}
  });

  assert.equal(response.statusCode, 401);
  assert.ok(response.body && response.body.error);
});

test("GET /operator/analytics returns 501 not_supported — Redis removed", async () => {
  const response = await request("/operator/analytics");

  assert.equal(response.statusCode, 501);
  assert.deepEqual(response.body, { error: "not_supported", detail: "Analytics require Redis which has been removed." });
});

test("POST /operator/rollup/nightly returns 501 not_supported — Redis removed", async () => {
  const response = await request("/operator/rollup/nightly?day=2099-01-01");

  assert.equal(response.statusCode, 501);
  assert.deepEqual(response.body, { error: "not_supported" });
});
