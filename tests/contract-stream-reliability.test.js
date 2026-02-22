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

test("atomic gate decisions remain deterministic under concurrent requests", async () => {
  const runtime = createRedisRuntime();
  const now = Date.now();
  runtime.state.sessions.set("198.51.100.1", now - 1000);
  runtime.state.sessions.set("198.51.100.2", now - 2000);

  setRedisEnv();

  const originalFetch = global.fetch;
  global.fetch = runtime.fetch;
  const handler = loadServerless();

  try {
    const responses = await Promise.all([
      request(handler, "/stream/series/tt0388629%3A1%3A1.json", { ip: "198.51.100.21" }),
      request(handler, "/stream/series/tt0388629%3A1%3A1.json", { ip: "198.51.100.22" }),
      request(handler, "/stream/series/tt0388629%3A1%3A1.json", { ip: "198.51.100.23" })
    ]);

    for (const response of responses) {
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.body.streams, []);
      assert.match(response.body.notice, /capacity is currently full/i);
    }
    assert.equal(runtime.state.sessions.size, 2);
  } finally {
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../serverless")];
  }
});

test("fair idle rotation admits contender by replacing oldest idle session", async () => {
  const runtime = createRedisRuntime();
  const now = Date.now();
  runtime.state.sessions.set("198.51.100.1", now - 80000);
  runtime.state.sessions.set("198.51.100.2", now - 4000);

  setRedisEnv();

  const originalFetch = global.fetch;
  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  addon.resolveEpisode = async () => ({
    url: "https://cdn.example.com/onepiece-1-1.mp4",
    title: "One Piece S1E1"
  });
  global.fetch = runtime.fetch;
  const handler = loadServerless();

  try {
    const response = await request(handler, "/stream/series/tt0388629%3A1%3A1.json", { ip: "198.51.100.9" });
    assert.equal(response.statusCode, 200);
    assert.match(response.body.streams[0].url, /^https:\/\//);
    assert.ok(runtime.state.sessions.has("198.51.100.9"));
    assert.ok(runtime.state.sessions.has("198.51.100.2"));
    assert.ok(!runtime.state.sessions.has("198.51.100.1"));
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

test("reconnect grace preserves existing session continuity while new contenders stay blocked", async () => {
  const runtime = createRedisRuntime();
  const now = Date.now();
  runtime.state.sessions.set("198.51.100.11", now - 5000);
  runtime.state.sessions.set("198.51.100.12", now - 6000);

  setRedisEnv();

  const originalFetch = global.fetch;
  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  addon.resolveEpisode = async () => ({
    url: "https://cdn.example.com/onepiece-1-1.mp4",
    title: "One Piece S1E1"
  });
  global.fetch = runtime.fetch;
  const handler = loadServerless();

  try {
    const existingResponse = await request(handler, "/stream/series/tt0388629%3A1%3A1.json", { ip: "198.51.100.11" });
    const contenderResponse = await request(handler, "/stream/series/tt0388629%3A1%3A1.json", { ip: "198.51.100.13" });

    assert.equal(existingResponse.statusCode, 200);
    assert.match(existingResponse.body.streams[0].url, /^https:\/\//);
    assert.deepEqual(contenderResponse.body.streams, []);
    assert.match(contenderResponse.body.notice, /capacity is currently full/i);
    assert.ok(runtime.state.sessions.has("198.51.100.11"));
    assert.ok(runtime.state.sessions.has("198.51.100.12"));
    assert.ok(!runtime.state.sessions.has("198.51.100.13"));
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

test("duplicate in-flight requests for same client and episode share one resolve path", async () => {
  const runtime = createRedisRuntime();

  setRedisEnv();

  const originalFetch = global.fetch;
  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  let resolveCount = 0;
  addon.resolveEpisode = async () => {
    resolveCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return {
      url: "https://cdn.example.com/onepiece-1-1.mp4",
      title: "One Piece S1E1"
    };
  };
  global.fetch = runtime.fetch;
  const handler = loadServerless();

  try {
    const [first, second] = await Promise.all([
      request(handler, "/stream/series/tt0388629%3A1%3A1.json", { ip: "198.51.100.44" }),
      request(handler, "/stream/series/tt0388629%3A1%3A1.json", { ip: "198.51.100.44" })
    ]);

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(resolveCount, 1);
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

test("latest request wins during rapid same-client episode switching while duplicate requests still coalesce", async () => {
  const runtime = createRedisRuntime();

  setRedisEnv();

  const originalFetch = global.fetch;
  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  const resolveCounts = new Map();
  addon.resolveEpisode = async (episodeId) => {
    resolveCounts.set(episodeId, Number(resolveCounts.get(episodeId) || 0) + 1);
    if (episodeId.endsWith(":1:10")) {
      await new Promise((resolve) => setTimeout(resolve, 35));
      return {
        url: "https://cdn.example.com/onepiece-1-10.mp4",
        title: "One Piece S1E10"
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
    return {
      url: "https://cdn.example.com/onepiece-1-11.mp4",
      title: "One Piece S1E11"
    };
  };

  global.fetch = runtime.fetch;
  const handler = loadServerless();

  try {
    const clientIp = "198.51.100.51";
    const requestA1 = request(handler, "/stream/series/tt0388629%3A1%3A10.json", { ip: clientIp });
    const requestA2 = request(handler, "/stream/series/tt0388629%3A1%3A10.json", { ip: clientIp });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const requestB = request(handler, "/stream/series/tt0388629%3A1%3A11.json", { ip: clientIp });

    const [responseA1, responseA2, responseB] = await Promise.all([requestA1, requestA2, requestB]);

    assert.equal(responseA1.statusCode, 200);
    assert.equal(responseA2.statusCode, 200);
    assert.equal(responseB.statusCode, 200);

    assert.match(responseA1.body.streams[0].url, /onepiece-1-11\.mp4$/);
    assert.match(responseA2.body.streams[0].url, /onepiece-1-11\.mp4$/);
    assert.match(responseB.body.streams[0].url, /onepiece-1-11\.mp4$/);

    assert.equal(resolveCounts.get("tt0388629:1:10"), 1);
    assert.equal(resolveCounts.get("tt0388629:1:11"), 1);
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

test("broker resolve retries once on transient HTTP failure", async () => {
  process.env.B_BASE_URL = "https://broker.example";
  let calls = 0;

  const originalFetch = global.fetch;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 503,
        async json() {
          return { error: "temporary" };
        }
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return { url: "https://cdn.example.com/onepiece-1-2.mp4", filename: "One Piece S1E2.mp4" };
      }
    };
  };

  try {
    const addon = loadAddon();
    const resolved = await addon.resolveEpisode("tt0388629:1:2");
    assert.equal(calls, 2);
    assert.match(resolved.url, /^https:\/\//);
  } finally {
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../addon")];
  }
});

test("broker resolve timeout path stays within bounded retry budget", async () => {
  process.env.B_BASE_URL = "https://broker.example";
  let calls = 0;

  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) => {
    calls += 1;
    return new Promise((resolve, reject) => {
      const signal = options.signal;
      if (!signal) return;
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.code = "AbortError";
        reject(error);
      }, { once: true });
    });
  };

  try {
    const addon = loadAddon();
    const startedAt = Date.now();
    await assert.rejects(() => addon.resolveEpisode("tt0388629:1:3"));
    const elapsed = Date.now() - startedAt;

    assert.equal(calls, 2);
    assert.ok(elapsed < 6200, `expected timeout budget under 6200ms, got ${elapsed}ms`);
  } finally {
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../addon")];
  }
});

test("broker resolve accepts links-array payload shape", async () => {
  process.env.B_BASE_URL = "https://broker.example";

  const originalFetch = global.fetch;
  global.fetch = async () => {
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          links: [
            {
              url: "https://cdn.example.com/onepiece-1-4.mp4",
              filename: "One Piece S1E4.mp4"
            }
          ]
        };
      }
    };
  };

  try {
    const addon = loadAddon();
    const resolved = await addon.resolveEpisode("tt0388629:1:4");
    assert.equal(resolved.url, "https://cdn.example.com/onepiece-1-4.mp4");
  } finally {
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../addon")];
  }
});
