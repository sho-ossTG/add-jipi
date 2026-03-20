const test = require("node:test");
const assert = require("node:assert/strict");
const {
  loadAddon,
  loadServerless,
  requestWithHandler
} = require("./helpers/runtime-fixtures");

async function request(handler, pathname, options = {}) {
  const response = await requestWithHandler(handler, pathname, options);
  return {
    statusCode: response.statusCode,
    body: response.body
  };
}

test("concurrent stream requests are all admitted — no slot gate", async () => {
  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  addon.resolveEpisode = async () => ({
    url: "https://cdn.example.com/onepiece-1-1.mp4",
    title: "One Piece S1E1"
  });
  const handler = loadServerless();

  try {
    const responses = await Promise.all([
      request(handler, "/stream/series/tt0388629%3A1%3A1.json", { ip: "198.51.100.21" }),
      request(handler, "/stream/series/tt0388629%3A1%3A1.json", { ip: "198.51.100.22" }),
      request(handler, "/stream/series/tt0388629%3A1%3A1.json", { ip: "198.51.100.23" })
    ]);

    for (const response of responses) {
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.streams.length, 1);
      assert.match(response.body.streams[0].url, /^https:\/\//);
    }
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

test("multiple distinct IPs all receive successful stream responses", async () => {
  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  addon.resolveEpisode = async () => ({
    url: "https://cdn.example.com/onepiece-1-1.mp4",
    title: "One Piece S1E1"
  });
  const handler = loadServerless();

  try {
    const ips = [
      "198.51.100.1",
      "198.51.100.2",
      "198.51.100.9"
    ];
    for (const ip of ips) {
      const response = await request(handler, "/stream/series/tt0388629%3A1%3A1.json", { ip });
      assert.equal(response.statusCode, 200);
      assert.match(response.body.streams[0].url, /^https:\/\//);
    }
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

test("same IP requesting same episode twice both succeed", async () => {
  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  addon.resolveEpisode = async () => ({
    url: "https://cdn.example.com/onepiece-1-9.mp4",
    title: "One Piece S1E9"
  });
  const handler = loadServerless();

  try {
    const first = await request(handler, "/stream/series/tt0388629%3A1%3A9.json", {
      ip: "203.0.113.9",
      headers: {
        "x-forwarded-for": "203.0.113.9",
        "user-agent": "ACCS2-First/1.0"
      }
    });
    assert.equal(first.statusCode, 200);

    const second = await request(handler, "/stream/series/tt0388629%3A1%3A9.json", {
      ip: "203.0.113.9",
      headers: {
        "x-forwarded-for": "203.0.113.9",
        "user-agent": "ACCS2-Reconnect/1.0"
      }
    });
    assert.equal(second.statusCode, 200);
    assert.match(second.body.streams[0].url, /^https:\/\//);
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

test("D resolve retries once on transient HTTP failure", async () => {
  process.env.D_BASE_URL = "https://d.example";
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
        return { url: "https://cdn.example.com/onepiece-1-2.mp4", title: "One Piece S1E2", filename: "onepiece-1-2.mp4" };
      }
    };
  };

  try {
    const addon = loadAddon();
    const resolved = await addon.resolveEpisode("tt0388629:1:2");
    assert.equal(calls, 2);
    assert.match(resolved.url, /^https:\/\//);
  } finally {
    delete process.env.D_BASE_URL;
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../addon")];
  }
});

test("D resolve timeout path stays within bounded retry budget", async () => {
  process.env.D_BASE_URL = "https://d.example";
  process.env.D_ATTEMPT_TIMEOUT_MS = "1800";
  process.env.D_TOTAL_TIMEOUT_MS = "5000";
  process.env.D_RETRY_JITTER_MS = "150";
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

    assert.ok(calls >= 2, `expected at least 2 calls, got ${calls}`);
    assert.ok(elapsed < 6200, `expected timeout budget under 6200ms, got ${elapsed}ms`);
  } finally {
    delete process.env.D_BASE_URL;
    delete process.env.D_ATTEMPT_TIMEOUT_MS;
    delete process.env.D_TOTAL_TIMEOUT_MS;
    delete process.env.D_RETRY_JITTER_MS;
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../addon")];
  }
});

test("D resolve rejects legacy links-array payloads", async () => {
  process.env.D_BASE_URL = "https://d.example";

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
    await assert.rejects(
      () => addon.resolveEpisode("tt0388629:1:4"),
      (error) => error && error.code === "validation_error"
    );
  } finally {
    delete process.env.D_BASE_URL;
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../addon")];
  }
});
