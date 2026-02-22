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

function mockRedisFetch(mode = "allow") {
  return async function fetch(url, options = {}) {
    const payload = JSON.parse(options.body || "[]");
    const command = Array.isArray(payload) ? payload[0] : [];
    const op = command[0];
    const key = command[1];
    let result = "OK";

    if (op === "GET") {
      if (key === "system:reset:2099-01-01") result = "1";
      else if (String(key || "").startsWith("active:url:")) result = null;
      else if (String(key || "").startsWith("stats:")) result = 0;
      else result = "1";
    }

    if (op === "EVAL") {
      result = mode === "slot-blocked"
        ? [0, "blocked:slot_taken", "", 2]
        : [1, "admitted:new", "", 1];
    }

    if (op === "ZSCORE") result = mode === "slot-blocked" ? null : "1";
    if (op === "ZCARD") result = mode === "slot-blocked" ? 2 : 1;
    if (op === "PING") result = "PONG";

    return {
      ok: true,
      async json() {
        return [{ result }];
      }
    };
  };
}

function withFixedJerusalemTime(run) {
  const originalDateTimeFormat = Intl.DateTimeFormat;

  Intl.DateTimeFormat = function MockDateTimeFormat() {
    return {
      formatToParts() {
        return [
          { type: "year", value: "2099" },
          { type: "month", value: "01" },
          { type: "day", value: "01" },
          { type: "hour", value: "12" },
          { type: "minute", value: "00" },
          { type: "second", value: "00" }
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

async function request(pathname, options = {}) {
  const { mode = "allow", resolveEpisode } = options;

  process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";

  const originalFetch = global.fetch;
  global.fetch = mockRedisFetch(mode);

  const addon = require("../addon");
  const originalResolveEpisode = addon.resolveEpisode;
  if (resolveEpisode) addon.resolveEpisode = resolveEpisode;

  delete require.cache[require.resolve("../serverless")];
  const handler = require("../serverless");

  const req = {
    method: "GET",
    url: pathname,
    headers: { host: "localhost:3000", "x-forwarded-for": "203.0.113.1" },
    socket: { remoteAddress: "203.0.113.1" }
  };
  const res = createResponse();

  try {
    await withFixedJerusalemTime(async () => {
      await handler(req, res);
    });
    return {
      statusCode: res.statusCode,
      headers: res.headers,
      body: res.body ? JSON.parse(res.body) : null
    };
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
