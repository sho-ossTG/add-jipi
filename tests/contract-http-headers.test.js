const test = require("node:test");
const assert = require("node:assert/strict");
const { loadHttpHandlerWithRouter, runHandler } = require("./helpers/runtime-fixtures");

function createRuntimeRouter() {
  return (req, res, next) => {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    if (pathname === "/manifest.json") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ id: "org.jipi.onepiece" }));
      return;
    }

    if (pathname.startsWith("/catalog/")) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ metas: [] }));
      return;
    }

    if (typeof next === "function") {
      next();
    }
  };
}

test("JSON health responses include utf-8 content type", async () => {
  const { createHttpHandler, cleanup } = loadHttpHandlerWithRouter(createRuntimeRouter());
  try {
    const result = await runHandler(createHttpHandler, {
      method: "GET",
      url: "/health",
      headers: {
        host: "localhost"
      }
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["content-type"], "application/json; charset=utf-8");
  } finally {
    cleanup();
  }
});

test("OPTIONS preflight for allowed origin is deterministic and cacheable", async () => {
  const { createHttpHandler, cleanup } = loadHttpHandlerWithRouter(createRuntimeRouter());
  try {
    const result = await runHandler(createHttpHandler, {
      method: "OPTIONS",
      url: "/manifest.json",
      headers: {
        host: "localhost",
        origin: "https://example.com",
        "access-control-request-method": "GET",
        "access-control-request-headers": "Content-Type,Authorization"
      }
    });

    assert.equal(result.statusCode, 204);
    assert.equal(result.headers["content-length"], "0");
    assert.equal(result.headers["access-control-max-age"], "7200");
    assert.equal(result.headers["access-control-allow-methods"], "GET,OPTIONS");
    assert.equal(result.headers["access-control-allow-headers"], "content-type,authorization,x-operator-token");
  } finally {
    cleanup();
  }
});

test("OPTIONS preflight for blocked origin still returns deterministic 204 envelope", async () => {
  const { createHttpHandler, cleanup } = loadHttpHandlerWithRouter(createRuntimeRouter());
  try {
    const result = await runHandler(createHttpHandler, {
      method: "OPTIONS",
      url: "/health",
      headers: {
        host: "localhost"
      }
    });

    assert.equal(result.statusCode, 204);
    assert.equal(result.headers["content-length"], "0");
  } finally {
    cleanup();
  }
});

test("manifest responses expose explicit cache-control policy", async () => {
  const { createHttpHandler, cleanup } = loadHttpHandlerWithRouter(createRuntimeRouter());
  try {
    const result = await runHandler(createHttpHandler, {
      method: "GET",
      url: "/manifest.json",
      headers: {
        host: "localhost"
      }
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["cache-control"], "public, max-age=300, must-revalidate");
  } finally {
    cleanup();
  }
});

test("non-manifest stremio routes are not forced to use manifest cache-control", async () => {
  const { createHttpHandler, cleanup } = loadHttpHandlerWithRouter(createRuntimeRouter());
  try {
    const result = await runHandler(createHttpHandler, {
      method: "GET",
      url: "/catalog/series/onepiece_catalog.json",
      headers: {
        host: "localhost"
      }
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["cache-control"], undefined);
  } finally {
    cleanup();
  }
});
