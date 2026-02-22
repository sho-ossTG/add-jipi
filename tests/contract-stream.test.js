const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createMockRedisFetch,
  loadAddon,
  loadServerless,
  requestWithHandler,
  setRedisEnv
} = require("./helpers/runtime-fixtures");

async function request(pathname, options = {}) {
  const { mode = "allow", resolveEpisode } = options;
  setRedisEnv();

  const originalFetch = global.fetch;
  global.fetch = createMockRedisFetch(mode);

  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  if (resolveEpisode) addon.resolveEpisode = resolveEpisode;

  const handler = loadServerless();

  try {
    return await requestWithHandler(handler, pathname, {
      ip: "203.0.113.1",
      headers: { "x-forwarded-for": "203.0.113.1" }
    });
  } finally {
    global.fetch = originalFetch;
    addon.resolveEpisode = originalResolveEpisode;
    delete require.cache[require.resolve("../serverless")];
  }
}

test("GET supported stream returns contract-valid HTTPS stream payload", async () => {
  const response = await request("/stream/series/tt0388629%3A1%3A1.json", {
    resolveEpisode: async () => ({
      url: "http://cdn.example.com/onepiece-1-1.mp4",
      title: "One Piece S1E1"
    })
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /^application\/json/);
  assert.ok(Array.isArray(response.body.streams));
  assert.equal(response.body.streams.length, 1);

  const stream = response.body.streams[0];
  assert.equal(stream.name, "Jipi");
  assert.equal(stream.title, "One Piece S1E1");
  assert.match(stream.url, /^https:\/\//);
  assert.equal(stream.behaviorHints.notWebReady, true);
});

test("GET stream route blocked by controls returns protocol-safe empty streams", async () => {
  const response = await request("/stream/series/tt0388629%3A1%3A1.json", {
    mode: "slot-blocked"
  });

  assert.equal(response.statusCode, 200);
  assert.ok(Array.isArray(response.body.streams));
  assert.deepEqual(response.body.streams, []);
  assert.match(response.body.notice, /capacity is currently full/i);
});

test("GET unsupported stream id returns empty streams payload", async () => {
  const response = await request("/stream/series/tt9999999%3A1%3A1.json");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { streams: [] });
});
