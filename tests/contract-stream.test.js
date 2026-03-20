const test = require("node:test");
const assert = require("node:assert/strict");
const {
  loadAddon,
  loadServerless,
  requestWithHandler
} = require("./helpers/runtime-fixtures");
const { resetBaseLoggerForTest, setBaseLoggerForTest } = require("../observability/logger");

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createCaptureLogger(events = [], bindings = {}) {
  return {
    child(nextBindings = {}) {
      return createCaptureLogger(events, { ...bindings, ...nextBindings });
    },
    info() {},
    error() {},
    warn(payload = {}, message = "") {
      events.push({
        ...bindings,
        ...(payload || {}),
        message: String(message || "")
      });
    }
  };
}

async function request(pathname, options = {}) {
  const { resolveEpisode } = options;

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
  assert.equal(stream.behaviorHints.notWebReady, false);
});

test("GET stream route always admits requests — no slot gate", async () => {
  const response = await request("/stream/series/tt0388629%3A1%3A1.json", {
    resolveEpisode: async () => ({
      url: "https://cdn.example.com/onepiece-1-1.mp4",
      title: "One Piece S1E1"
    })
  });

  assert.equal(response.statusCode, 200);
  assert.ok(Array.isArray(response.body.streams));
  assert.equal(response.body.streams.length, 1);
  assert.match(response.body.streams[0].url, /^https:\/\//);
});

test("GET unsupported stream id returns empty streams payload", async () => {
  const response = await request("/stream/series/tt9999999%3A1%3A1.json");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { streams: [] });
});

test("manifest and catalog are always available — no gate", async () => {
  const manifestResponse = await request("/manifest.json");
  assert.equal(manifestResponse.statusCode, 200);
  assert.equal(manifestResponse.body.id, "org.jipi.onepiece");

  const catalogResponse = await request("/catalog/series/onepiece_catalog.json");
  assert.equal(catalogResponse.statusCode, 200);
  assert.ok(Array.isArray(catalogResponse.body.metas));
  assert.ok(catalogResponse.body.metas.length > 0);

  const streamResponse = await request("/stream/series/tt0388629%3A1%3A1.json", {
    resolveEpisode: async () => ({
      url: "https://cdn.example.com/onepiece-1-1.mp4",
      title: "One Piece S1E1"
    })
  });
  assert.equal(streamResponse.statusCode, 200);
  assert.equal(streamResponse.body.streams.length, 1);
});

test("stream response completes before pending UA forwarding resolves", async () => {
  const originalDBaseUrl = process.env.D_BASE_URL;
  let releaseUaForward;
  const pendingUaForward = new Promise((resolve) => {
    releaseUaForward = resolve;
  });
  let uaCallCount = 0;

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url) === "https://d.example/api/ua") {
      uaCallCount += 1;
      return pendingUaForward;
    }
    if (originalFetch) return originalFetch(url);
    throw new Error("unexpected fetch: " + url);
  };
  process.env.D_BASE_URL = "https://d.example";

  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  addon.resolveEpisode = async () => ({
    url: "https://cdn.example.com/onepiece-1-2.mp4",
    title: "One Piece S1E2"
  });

  delete require.cache[require.resolve("../modules/routing/stream-route")];
  const handler = loadServerless();

  try {
    const responsePromise = requestWithHandler(handler, "/stream/series/tt0388629%3A1%3A2.json", {
      ip: "203.0.113.1",
      headers: {
        "x-forwarded-for": "203.0.113.1",
        "user-agent": "FR4-NonBlocking/1.0"
      }
    });
    const raced = await Promise.race([
      responsePromise,
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 250))
    ]);

    assert.notEqual(raced, "timeout");
    assert.equal(raced.statusCode, 200);
    assert.ok(Array.isArray(raced.body.streams));
    assert.equal(raced.body.streams.length, 1);
    assert.equal(raced.body.streams[0].title, "One Piece S1E2");

    await flushMicrotasks();
    assert.equal(uaCallCount, 1);
  } finally {
    if (typeof releaseUaForward === "function") {
      releaseUaForward({
        ok: true,
        status: 202,
        async json() {
          return {};
        }
      });
      await flushMicrotasks();
    }
    global.fetch = originalFetch;
    if (typeof originalDBaseUrl === "undefined") delete process.env.D_BASE_URL;
    else process.env.D_BASE_URL = originalDBaseUrl;
    addon.resolveEpisode = originalResolveEpisode;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../modules/routing/stream-route")];
  }
});

test("UA forwarding failure logs warn and keeps stream payload stable", async () => {
  const originalDBaseUrl = process.env.D_BASE_URL;
  const warningEvents = [];
  setBaseLoggerForTest(createCaptureLogger(warningEvents));

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url) === "https://d.example/api/ua") {
      const error = new Error("ua forward transport failed");
      error.code = "dependency_unavailable";
      throw error;
    }
    if (originalFetch) return originalFetch(url);
    throw new Error("unexpected fetch: " + url);
  };
  process.env.D_BASE_URL = "https://d.example";

  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  addon.resolveEpisode = async () => ({
    url: "https://cdn.example.com/onepiece-1-3.mp4",
    title: "One Piece S1E3"
  });

  delete require.cache[require.resolve("../modules/routing/stream-route")];
  const handler = loadServerless();

  try {
    const responsePromise = requestWithHandler(handler, "/stream/series/tt0388629%3A1%3A3.json", {
      ip: "203.0.113.1",
      headers: {
        "x-forwarded-for": "203.0.113.1",
        "user-agent": "FR4-Failure/1.0"
      }
    });

    const response = await Promise.race([
      responsePromise,
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 250))
    ]);

    assert.notEqual(response, "timeout");

    assert.equal(response.statusCode, 200);
    assert.ok(Array.isArray(response.body.streams));
    assert.equal(response.body.streams.length, 1);
    assert.equal(response.body.streams[0].title, "One Piece S1E3");

    await flushMicrotasks();
    await flushMicrotasks();

    const warning = warningEvents.find((entry) => entry.message === "ua_forward_failed");
    assert.ok(warning);
    assert.equal(warning.episodeId, "tt0388629:1:3");
    assert.equal(warning.userAgent, "FR4-Failure/1.0");
    assert.equal(warning.errorCode, "dependency_unavailable");
  } finally {
    resetBaseLoggerForTest();
    global.fetch = originalFetch;
    if (typeof originalDBaseUrl === "undefined") delete process.env.D_BASE_URL;
    else process.env.D_BASE_URL = originalDBaseUrl;
    addon.resolveEpisode = originalResolveEpisode;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../modules/routing/stream-route")];
  }
});
