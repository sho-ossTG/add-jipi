const test = require("node:test");
const assert = require("node:assert/strict");
const { createHttpHandler } = require("../modules/routing/http-handler");
const {
  loadAddon,
  requestWithHandler
} = require("./helpers/runtime-fixtures");

const STREMIO_ORIGIN = "https://web.stremio.com";

function assertPermissiveStremioOrigin(value) {
  assert.ok(value === "*" || value === STREMIO_ORIGIN);
}

async function request(pathname, options = {}) {
  const { origin = STREMIO_ORIGIN } = options;
  process.env.CORS_ALLOW_ORIGINS = "https://allowed.example";

  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;

  addon.resolveEpisode = async () => ({
    url: "https://cdn.example.com/onepiece-1-1.mp4",
    title: "One Piece S1E1"
  });

  try {
    return await requestWithHandler(createHttpHandler, pathname, {
      headers: {
        origin,
        "x-forwarded-for": "203.0.113.1"
      },
      ip: "203.0.113.1"
    });
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
  }
}

test("Stremio origin can fetch manifest with permissive CORS", async () => {
  const response = await request("/manifest.json");

  assert.equal(response.statusCode, 200);
  assertPermissiveStremioOrigin(response.headers["access-control-allow-origin"]);
  assert.match(response.headers["content-type"], /^application\/json/);
  assert.equal(response.body.id, "org.jipi.onepiece");
});

test("Stremio origin can fetch catalog with permissive CORS", async () => {
  const response = await request("/catalog/series/onepiece_catalog.json");

  assert.equal(response.statusCode, 200);
  assertPermissiveStremioOrigin(response.headers["access-control-allow-origin"]);
  assert.match(response.headers["content-type"], /^application\/json/);
  assert.ok(Array.isArray(response.body.metas));
});

test("Stremio origin can fetch stream with permissive CORS", async () => {
  const response = await request("/stream/series/tt0388629%3A1%3A1.json");

  assert.equal(response.statusCode, 200);
  assertPermissiveStremioOrigin(response.headers["access-control-allow-origin"]);
  assert.match(response.headers["content-type"], /^application\/json/);
  assert.ok(Array.isArray(response.body.streams));
  assert.equal(response.body.streams.length, 1);
});

test("Non-Stremio routes keep allowlist CORS restrictions", async () => {
  const response = await request("/health");

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  assert.deepEqual(response.body, { status: "OK" });
});
