const test = require("node:test");
const assert = require("node:assert/strict");
const { createDClient } = require("../modules/integrations/d-client");
const { withRequestContext } = require("../observability/context");

function createJsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function isIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

test("resolveEpisode throws dependency_unavailable when D_BASE_URL is unset", async () => {
  let calls = 0;
  const client = createDClient({
    fetchImpl: async () => {
      calls += 1;
      return createJsonResponse(200, { url: "https://example.test", filename: "x" });
    },
    env: {}
  });

  await assert.rejects(async () => client.resolveEpisode("tt123:1:2"), {
    code: "dependency_unavailable"
  });
  assert.equal(calls, 0);
});

test("side-channel methods no-op without D_BASE_URL and do not call fetch", async () => {
  let calls = 0;
  const client = createDClient({
    fetchImpl: async () => {
      calls += 1;
      return createJsonResponse(200, {});
    },
    env: {}
  });

  assert.doesNotThrow(() => client.forwardUserAgent("ua", "tt123:1:2"));
  await flushMicrotasks();

  assert.equal(calls, 0);
});

test("forwardUserAgent sends expected payload and stays fire-and-forget safe", async () => {
  let callCount = 0;
  let captured;
  let releaseFetch;
  const fetchPending = new Promise((resolve) => {
    releaseFetch = resolve;
  });

  const client = createDClient({
    baseUrl: "https://d.example",
    fetchImpl: async (url, options) => {
      callCount += 1;
      captured = { url, options };
      return fetchPending;
    }
  });

  const runInContext = withRequestContext(
    { headers: { "x-correlation-id": "cid-ua-123" } },
    () => client.forwardUserAgent("MyAgent/1.0", "tt123:1:2", { clientIp: "198.51.100.10" })
  );

  assert.equal(callCount, 0);
  const result = await runInContext;
  assert.equal(result, undefined);

  await flushMicrotasks();
  assert.equal(callCount, 1);
  assert.equal(captured.url, "https://d.example/api/ua");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers["content-type"], "application/json");
  assert.equal(captured.options.headers["x-correlation-id"], "cid-ua-123");
  assert.equal(captured.options.headers["x-client-ip"], "198.51.100.10");

  const payload = JSON.parse(captured.options.body);
  assert.equal(payload.userAgent, "MyAgent/1.0");
  assert.equal(payload.episodeId, "tt123:1:2");
  assert.equal(isIsoTimestamp(payload.timestamp), true);

  releaseFetch(createJsonResponse(202, {}));
  await flushMicrotasks();
});

test("resolveEpisode includes x-correlation-id header on D resolve request", async () => {
  let captured;
  const client = createDClient({
    baseUrl: "https://d.example",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return createJsonResponse(200, { url: "https://ok.test/stream.m3u8", filename: "episode.mp4" });
    },
    executeBoundedDependency: async (operation) => operation({ timeout: 50 })
  });

  const result = await withRequestContext(
    { headers: { "x-correlation-id": "cid-resolve-123" } },
    async () => client.resolveEpisode("tt123:1:2", { clientIp: "198.51.100.11" })
  );

  assert.equal(captured.url, "https://d.example/api/resolve");
  assert.equal(captured.options.headers["content-type"], "application/json");
  assert.equal(captured.options.headers["x-correlation-id"], "cid-resolve-123");
  assert.equal(captured.options.headers["x-client-ip"], "198.51.100.11");
  assert.deepEqual(result, { url: "https://ok.test/stream.m3u8", title: "episode.mp4" });
});

test("resolveEpisode preserves dependency_timeout from bounded helper", async () => {
  const client = createDClient({
    baseUrl: "https://d.example",
    fetchImpl: async () => createJsonResponse(200, { url: "https://example.test", filename: "ok" }),
    executeBoundedDependency: async () => {
      const err = new Error("timed out");
      err.code = "dependency_timeout";
      throw err;
    }
  });

  await assert.rejects(async () => client.resolveEpisode("tt123:1:2"), {
    code: "dependency_timeout"
  });
});

test("resolveEpisode maps non-2xx and 503 to dependency_unavailable", async () => {
  const runCase = async (status) => {
    const client = createDClient({
      baseUrl: "https://d.example",
      fetchImpl: async () => createJsonResponse(status, { error: "nope" }),
      executeBoundedDependency: async (operation) => operation({ timeout: 50 })
    });

    await assert.rejects(async () => client.resolveEpisode("tt123:1:2"), {
      code: "dependency_unavailable"
    });
  };

  await runCase(503);
  await runCase(500);
  await runCase(400);
});

test("resolveEpisode maps network failures to dependency_unavailable", async () => {
  const client = createDClient({
    baseUrl: "https://d.example",
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
    executeBoundedDependency: async (operation) => operation({ timeout: 50 })
  });

  await assert.rejects(async () => client.resolveEpisode("tt123:1:2"), {
    code: "dependency_unavailable"
  });
});

test("resolveEpisode validates url/filename contract", async () => {
  const invalidPayloads = [
    { filename: "Missing URL" },
    { url: "http://insecure.test", filename: "Bad URL" },
    { url: "https://valid.test" },
    { url: "https://valid.test", filename: "" },
    { url: "https://valid.test", filename: "   " }
  ];

  for (const payload of invalidPayloads) {
    const client = createDClient({
      baseUrl: "https://d.example",
      fetchImpl: async () => createJsonResponse(200, payload),
      executeBoundedDependency: async (operation) => operation({ timeout: 50 })
    });

    await assert.rejects(async () => client.resolveEpisode("tt123:1:2"), {
      code: "validation_error"
    });
  }
});

test("resolveEpisode uses D timeout defaults with bounded dependency", async () => {
  let observedOptions;
  const client = createDClient({
    baseUrl: "https://d.example",
    fetchImpl: async () => createJsonResponse(200, { url: "https://ok.test", filename: "Ok" }),
    executeBoundedDependency: async (operation, options) => {
      observedOptions = options;
      return operation({ timeout: 25 });
    }
  });

  await client.resolveEpisode("tt123:1:2");

  assert.deepEqual(observedOptions, {
    attemptTimeoutMs: 5000,
    totalBudgetMs: 67000,
    jitterMs: 150
  });
});
