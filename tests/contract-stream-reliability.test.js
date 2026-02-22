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

function withFixedJerusalemTime(run, overrides = {}) {
  const originalDateTimeFormat = Intl.DateTimeFormat;
  const hour = String(overrides.hour || "12").padStart(2, "0");
  const minute = String(overrides.minute || "00").padStart(2, "0");
  const second = String(overrides.second || "00").padStart(2, "0");

  Intl.DateTimeFormat = function MockDateTimeFormat() {
    return {
      formatToParts() {
        return [
          { type: "year", value: "2099" },
          { type: "month", value: "01" },
          { type: "day", value: "01" },
          { type: "hour", value: hour },
          { type: "minute", value: minute },
          { type: "second", value: second }
        ];
      }
    };
  };

  return Promise.resolve()
    .then(run)
    .finally(() => {
      Intl.DateTimeFormat = originalDateTimeFormat;
    });
}

function createRedisRuntime() {
  const state = {
    strings: new Map(),
    sessions: new Map(),
    lists: new Map()
  };

  function nowSortedSessions() {
    return [...state.sessions.entries()].sort((left, right) => {
      if (left[1] !== right[1]) return left[1] - right[1];
      return left[0].localeCompare(right[0]);
    });
  }

  function evalGate(args) {
    const currentIp = String(args[0]);
    const nowMs = Number(args[1]);
    const pruneCutoff = Number(args[2]);
    const maxSessions = Number(args[3]);
    const reconnectGraceMs = Number(args[5]);
    const idleCutoff = Number(args[6]);

    for (const [ip, score] of [...state.sessions.entries()]) {
      if (score <= pruneCutoff) {
        state.sessions.delete(ip);
      }
    }

    if (state.sessions.has(currentIp)) {
      state.sessions.set(currentIp, nowMs);
      return [1, "admitted:existing", "", state.sessions.size];
    }

    if (state.sessions.size < maxSessions) {
      state.sessions.set(currentIp, nowMs);
      return [1, "admitted:new", "", state.sessions.size];
    }

    let rotation = null;
    for (const [ip, score] of nowSortedSessions()) {
      if (ip === currentIp) continue;
      const idleEnough = score <= idleCutoff;
      const outsideGrace = (nowMs - score) >= reconnectGraceMs;
      if (!idleEnough || !outsideGrace) continue;
      if (!rotation) {
        rotation = { ip, score };
        continue;
      }
      if (score < rotation.score || (score === rotation.score && ip.localeCompare(rotation.ip) < 0)) {
        rotation = { ip, score };
      }
    }

    if (rotation) {
      state.sessions.delete(rotation.ip);
      state.sessions.set(currentIp, nowMs);
      return [1, "admitted:rotated", rotation.ip, state.sessions.size];
    }

    return [0, "blocked:slot_taken", "", state.sessions.size];
  }

  async function fetch(_url, options = {}) {
    const payload = JSON.parse(options.body || "[]");
    const command = Array.isArray(payload) ? payload[0] : [];
    const op = String(command[0] || "").toUpperCase();
    const key = command[1];
    let result = "OK";

    if (op === "GET") {
      result = state.strings.has(key) ? state.strings.get(key) : null;
    }

    if (op === "SET") {
      state.strings.set(key, String(command[2]));
      result = "OK";
    }

    if (op === "DEL") {
      state.strings.delete(key);
      state.lists.delete(key);
      result = 1;
    }

    if (op === "INCR") {
      const current = Number(state.strings.get(key) || 0);
      const next = current + 1;
      state.strings.set(key, String(next));
      result = next;
    }

    if (op === "LPUSH") {
      const list = state.lists.get(key) || [];
      list.unshift(String(command[2] || ""));
      state.lists.set(key, list);
      result = list.length;
    }

    if (op === "LTRIM") {
      const list = state.lists.get(key) || [];
      const start = Number(command[2]);
      const end = Number(command[3]);
      state.lists.set(key, list.slice(start, end + 1));
      result = "OK";
    }

    if (op === "LRANGE") {
      result = state.lists.get(key) || [];
    }

    if (op === "ZCARD") {
      result = state.sessions.size;
    }

    if (op === "ZSCORE") {
      const member = String(command[2] || "");
      result = state.sessions.has(member) ? String(state.sessions.get(member)) : null;
    }

    if (op === "ZREM") {
      result = state.sessions.delete(command[2]) ? 1 : 0;
    }

    if (op === "ZADD") {
      const score = Number(command[2]);
      const member = String(command[3]);
      state.sessions.set(member, score);
      result = 1;
    }

    if (op === "ZREMRANGEBYSCORE") {
      const max = Number(command[3]);
      let removed = 0;
      for (const [member, score] of [...state.sessions.entries()]) {
        if (score <= max) {
          state.sessions.delete(member);
          removed += 1;
        }
      }
      result = removed;
    }

    if (op === "EVAL") {
      const args = command.slice(4);
      result = evalGate(args);
    }

    if (op === "PING") {
      result = "PONG";
    }

    return {
      ok: true,
      async json() {
        return [{ result }];
      }
    };
  }

  return { state, fetch };
}

async function request(handler, pathname, options = {}) {
  const {
    method = "GET",
    ip = "198.51.100.20",
    headers = {},
    jerusalemHour = "12"
  } = options;

  const req = {
    method,
    url: pathname,
    headers: {
      host: "localhost:3000",
      ...headers
    },
    socket: { remoteAddress: ip }
  };
  const res = createResponse();

  await withFixedJerusalemTime(async () => {
    await handler(req, res);
  }, { hour: jerusalemHour });

  return {
    statusCode: res.statusCode,
    body: res.body ? JSON.parse(res.body) : null
  };
}

function loadServerless() {
  delete require.cache[require.resolve("../serverless")];
  return require("../serverless");
}

function loadAddon() {
  delete require.cache[require.resolve("../addon")];
  return require("../addon");
}

test("atomic gate decisions remain deterministic under concurrent requests", async () => {
  const runtime = createRedisRuntime();
  const now = Date.now();
  runtime.state.sessions.set("198.51.100.1", now - 1000);
  runtime.state.sessions.set("198.51.100.2", now - 2000);

  process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";

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

  process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";

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

  process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";

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

  process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";

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

test("capacity and policy causes map to deterministic empty stream responses", async () => {
  const runtime = createRedisRuntime();
  const now = Date.now();
  runtime.state.sessions.set("198.51.100.1", now - 1000);
  runtime.state.sessions.set("198.51.100.2", now - 2000);

  process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";

  const originalFetch = global.fetch;
  global.fetch = runtime.fetch;
  const handler = loadServerless();

  try {
    const firstCapacity = await request(handler, "/stream/series/tt0388629%3A1%3A6.json", { ip: "198.51.100.31" });
    const secondCapacity = await request(handler, "/stream/series/tt0388629%3A1%3A6.json", { ip: "198.51.100.32" });
    const shutdownResponse = await request(handler, "/stream/series/tt0388629%3A1%3A6.json", {
      ip: "198.51.100.33",
      jerusalemHour: "02"
    });

    assert.equal(firstCapacity.statusCode, 200);
    assert.deepEqual(firstCapacity.body.streams, []);
    assert.match(firstCapacity.body.notice, /capacity is currently full/i);

    assert.equal(secondCapacity.statusCode, 200);
    assert.deepEqual(secondCapacity.body.streams, []);
    assert.equal(secondCapacity.body.notice, firstCapacity.body.notice);

    assert.equal(shutdownResponse.statusCode, 200);
    assert.deepEqual(shutdownResponse.body.streams, []);
    assert.match(shutdownResponse.body.notice, /paused between 00:00 and 08:00/i);
  } finally {
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../serverless")];
  }
});

test("dependency timeout and unavailable causes map to deterministic fallback streams", async () => {
  const runtime = createRedisRuntime();

  process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";

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

    const timeoutFirst = await request(handler, "/stream/series/tt0388629%3A1%3A7.json", { ip: "198.51.100.41" });
    const timeoutSecond = await request(handler, "/stream/series/tt0388629%3A1%3A7.json", { ip: "198.51.100.41" });

    assert.equal(timeoutFirst.statusCode, 200);
    assert.equal(timeoutFirst.body.streams.length, 1);
    assert.match(timeoutFirst.body.streams[0].title, /temporarily delayed/i);
    assert.equal(timeoutSecond.body.streams[0].title, timeoutFirst.body.streams[0].title);

    addon.resolveEpisode = async () => {
      const error = new Error("broker unavailable");
      error.code = "broker_http_error";
      error.statusCode = 503;
      throw error;
    };

    const unavailableFirst = await request(handler, "/stream/series/tt0388629%3A1%3A8.json", { ip: "198.51.100.41" });
    const unavailableSecond = await request(handler, "/stream/series/tt0388629%3A1%3A8.json", { ip: "198.51.100.41" });

    assert.equal(unavailableFirst.statusCode, 200);
    assert.equal(unavailableFirst.body.streams.length, 1);
    assert.match(unavailableFirst.body.streams[0].title, /temporarily unavailable/i);
    assert.equal(unavailableSecond.body.streams[0].title, unavailableFirst.body.streams[0].title);
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

test("latest request wins during rapid same-client episode switching while duplicate requests still coalesce", async () => {
  const runtime = createRedisRuntime();

  process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";

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
    assert.ok(elapsed < 2600, `expected timeout budget under 2600ms, got ${elapsed}ms`);
  } finally {
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../addon")];
  }
});
