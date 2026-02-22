const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRedisRuntime,
  loadAddon,
  loadServerless,
  requestWithHandler,
  setRedisEnv
} = require("./helpers/runtime-fixtures");

async function request(handler, pathname, options = {}) {
  const response = await requestWithHandler(handler, pathname, options);
  return {
    statusCode: response.statusCode,
    body: response.body
  };
}

test("dependency timeout maps to deterministic delayed fallback stream", async () => {
  const runtime = createRedisRuntime();
  setRedisEnv();

  const originalFetch = global.fetch;
  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  global.fetch = runtime.fetch;
  const handler = loadServerless();

  try {
    addon.resolveEpisode = async () => {
      const error = new Error("timeout");
      error.code = "dependency_timeout";
      throw error;
    };

    const response = await request(handler, "/stream/series/tt0388629%3A1%3A7.json", { ip: "198.51.100.41" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.streams.length, 1);
    assert.match(response.body.streams[0].url, /^https:\/\//);
    assert.match(response.body.streams[0].title, /temporarily delayed/i);
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

test("dependency unavailable maps to deterministic unavailable fallback stream", async () => {
  const runtime = createRedisRuntime();
  setRedisEnv();

  const originalFetch = global.fetch;
  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  global.fetch = runtime.fetch;
  const handler = loadServerless();

  try {
    addon.resolveEpisode = async () => {
      const error = new Error("broker unavailable");
      error.code = "broker_http_error";
      error.statusCode = 503;
      throw error;
    };

    const response = await request(handler, "/stream/series/tt0388629%3A1%3A8.json", { ip: "198.51.100.42" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.streams.length, 1);
    assert.match(response.body.streams[0].url, /^https:\/\//);
    assert.match(response.body.streams[0].title, /temporarily unavailable/i);
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

test("invalid upstream protocol degrades to unavailable fallback mapping", async () => {
  const runtime = createRedisRuntime();
  setRedisEnv();

  const originalFetch = global.fetch;
  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  global.fetch = runtime.fetch;
  const handler = loadServerless();

  try {
    addon.resolveEpisode = async () => ({
      url: "javascript:alert(1)",
      title: "bad protocol"
    });

    const response = await request(handler, "/stream/series/tt0388629%3A1%3A9.json", { ip: "198.51.100.43" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.streams.length, 1);
    assert.match(response.body.streams[0].url, /^https:\/\//);
    assert.match(response.body.streams[0].title, /temporarily unavailable/i);
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

test("policy-denied outcomes return deterministic protocol-safe empty responses", async () => {
  const runtime = createRedisRuntime();
  const now = Date.now();
  runtime.state.sessions.set("198.51.100.1", now - 1000);
  runtime.state.sessions.set("198.51.100.2", now - 2000);
  setRedisEnv();

  const originalFetch = global.fetch;
  global.fetch = runtime.fetch;
  const handler = loadServerless();

  try {
    const capacityResponse = await request(handler, "/stream/series/tt0388629%3A1%3A6.json", { ip: "198.51.100.31" });
    const shutdownResponse = await request(handler, "/stream/series/tt0388629%3A1%3A6.json", {
      ip: "198.51.100.33",
      jerusalemHour: "02"
    });

    assert.equal(capacityResponse.statusCode, 200);
    assert.deepEqual(capacityResponse.body.streams, []);
    assert.match(capacityResponse.body.notice, /capacity is currently full/i);

    assert.equal(shutdownResponse.statusCode, 200);
    assert.deepEqual(shutdownResponse.body.streams, []);
    assert.match(shutdownResponse.body.notice, /paused between 00:00 and 08:00/i);
  } finally {
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../serverless")];
  }
});
