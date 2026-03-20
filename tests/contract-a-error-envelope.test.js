const test = require("node:test");
const assert = require("node:assert/strict");
const {
  loadServerless,
  requestWithHandler
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
    const handler = loadServerless();

    try {
      await run(handler);
    } finally {
      delete require.cache[require.resolve("../serverless")];
    }
  };
}

test("/api/stats method guard returns strict error envelope", withServerA(async (handler) => {
  const response = await request(handler, "/api/stats", { method: "POST" });

  assert.equal(response.statusCode, 405);
  assert.deepEqual(Object.keys(response.body).sort(), ["detail", "error"]);
  assert.equal(response.body.error, "method_not_allowed");
  assert.equal(response.body.detail, "Use GET for /api/stats.");
}));

test("CORS preflight method denial returns strict error envelope", withServerA(async (handler) => {
  process.env.CORS_ALLOW_ORIGINS = "https://allowed.example";
  process.env.CORS_ALLOW_HEADERS = "Content-Type,Authorization,X-Operator-Token";
  process.env.CORS_ALLOW_METHODS = "GET,OPTIONS";

  const response = await request(handler, "/health", {
    method: "OPTIONS",
    headers: {
      origin: "https://allowed.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "Authorization"
    }
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(Object.keys(response.body).sort(), ["detail", "error"]);
  assert.equal(response.body.error, "cors_method_not_allowed");
  assert.equal(response.body.detail, "Requested method is not allowed by CORS policy.");
}));

test("CORS preflight header denial returns strict error envelope", withServerA(async (handler) => {
  process.env.CORS_ALLOW_ORIGINS = "https://allowed.example";
  process.env.CORS_ALLOW_HEADERS = "Content-Type,Authorization,X-Operator-Token";
  process.env.CORS_ALLOW_METHODS = "GET,OPTIONS";

  const response = await request(handler, "/health", {
    method: "OPTIONS",
    headers: {
      origin: "https://allowed.example",
      "access-control-request-method": "GET",
      "access-control-request-headers": "X-Custom-Header"
    }
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(Object.keys(response.body).sort(), ["detail", "error"]);
  assert.equal(response.body.error, "cors_header_not_allowed");
  assert.equal(response.body.detail, "Requested headers are not allowed by CORS policy.");
}));
