// Phase 42-01: RED tests for concurrency-guard behaviors. All tests MUST FAIL until
// modules/integrations/concurrency-guard.js is created in plan 42-02.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createConcurrencyGuard } = require("../modules/integrations/concurrency-guard");
const { handleStreamRequest } = require("../modules/routing/stream-route");

// Test 1 — singleflight deduplicates concurrent calls for same key
test("singleflight: concurrent calls for same key share one operation result", async () => {
  const guard = createConcurrencyGuard({ providerConcurrencyLimit: 10, globalConcurrencyLimit: 10 });

  let calls = 0;
  let resolveOp;
  const op = () => new Promise(res => { resolveOp = res; calls++; });

  const p1 = guard.execute("ep1", op);
  const p2 = guard.execute("ep1", op);

  resolveOp("done");
  const [r1, r2] = await Promise.all([p1, p2]);

  assert.equal(r1, "done", "first caller must receive the shared result");
  assert.equal(r2, "done", "second caller must receive the same shared result");
  assert.equal(calls, 1, "operation must be called exactly once for the same key");
});

// Test 2 — different keys each call operation independently
test("singleflight: different keys each invoke their own operation", async () => {
  const guard = createConcurrencyGuard({ providerConcurrencyLimit: 10, globalConcurrencyLimit: 10 });

  let calls = 0;
  const op = () => Promise.resolve((calls++, "done"));

  const [r1, r2] = await Promise.all([
    guard.execute("ep1", op),
    guard.execute("ep2", op)
  ]);

  assert.equal(r1, "done");
  assert.equal(r2, "done");
  assert.equal(calls, 2, "each distinct key must invoke its own operation; expected 2 calls");
});

// Test 3 — global cap rejects when limit reached (capacity_busy)
test("global cap: rejects with capacity_busy when globalConcurrencyLimit reached", async () => {
  const guard = createConcurrencyGuard({ providerConcurrencyLimit: 10, globalConcurrencyLimit: 1 });

  let resolveOp;
  const op = () => new Promise(res => { resolveOp = res; });

  const p1 = guard.execute("ep1", op);

  await assert.rejects(
    () => guard.execute("ep2", () => Promise.resolve("ok")),
    (err) => {
      assert.equal(err.code, "capacity_busy", "rejection must have err.code === 'capacity_busy'");
      return true;
    }
  );

  resolveOp("done");
  await p1;
});

// Test 4 — per-provider cap rejects when limit reached (capacity_busy)
test("per-provider cap: rejects with capacity_busy when providerConcurrencyLimit reached", async () => {
  const guard = createConcurrencyGuard({ providerConcurrencyLimit: 1, globalConcurrencyLimit: 10 });

  let resolveOp;
  const op = () => new Promise(res => { resolveOp = res; });

  const p1 = guard.execute("ep1", op);

  await assert.rejects(
    () => guard.execute("ep2", () => Promise.resolve("ok")),
    (err) => {
      assert.equal(err.code, "capacity_busy", "rejection must have err.code === 'capacity_busy'");
      return true;
    }
  );

  resolveOp("done");
  await p1;
});

// Test 5 — singleflight key cleaned up after rejection (next call is fresh)
test("singleflight: key cleaned up after operation rejects; next call runs fresh", async () => {
  const guard = createConcurrencyGuard({ providerConcurrencyLimit: 10, globalConcurrencyLimit: 10 });

  let calls = 0;
  const failingOp = async () => {
    calls++;
    throw new Error("operation failed");
  };

  await assert.rejects(() => guard.execute("ep1", failingOp), { message: "operation failed" });
  await assert.rejects(() => guard.execute("ep1", failingOp), { message: "operation failed" });

  assert.equal(calls, 2, "operation must be called again after first call rejects; expected 2 calls");
});

// Test 6 — stats() returns current in-flight counts
test("stats: returns accurate in-flight counts while operation is running", async () => {
  const guard = createConcurrencyGuard({ providerConcurrencyLimit: 10, globalConcurrencyLimit: 10 });

  let resolveOp;
  const op = () => new Promise(res => { resolveOp = res; });

  const p1 = guard.execute("ep1", op);

  const during = guard.stats();
  assert.equal(during.inflightKeys, 1, "inflightKeys must be 1 while operation is running");
  assert.equal(during.globalCount, 1, "globalCount must be 1 while operation is running");
  assert.equal(during.providerCount, 1, "providerCount must be 1 while operation is running");

  resolveOp("done");
  await p1;

  const after = guard.stats();
  assert.equal(after.inflightKeys, 0, "inflightKeys must be 0 after operation resolves");
  assert.equal(after.globalCount, 0, "globalCount must be 0 after operation resolves");
  assert.equal(after.providerCount, 0, "providerCount must be 0 after operation resolves");
});

// Test 7 — stream-route.js calls guard.execute with episodeId as key
test("stream-route wiring: guard.execute is called with episodeId as key", async () => {
  // Inject stubs into require.cache for all dependencies of stream-route
  const streamRouteId = require.resolve("../modules/routing/stream-route");
  const dClientId = require.resolve("../modules/integrations/d-client");
  const streamPayloadsId = require.resolve("../modules/presentation/stream-payloads");

  // Save originals to restore after test
  const origStreamRoute = require.cache[streamRouteId];
  const origDClient = require.cache[dClientId];

  // Build a spy guard
  const guardCalls = [];
  const spyGuard = {
    execute: (key, operation) => {
      guardCalls.push(key);
      return operation();
    }
  };

  // Stub d-client so resolveEpisode returns a valid result
  require.cache[dClientId] = {
    id: dClientId,
    filename: dClientId,
    loaded: true,
    exports: {
      createDClient: () => ({
        resolveEpisode: async () => ({ url: "https://example.com/test.mp4", title: "S01E01" }),
        forwardUserAgent: async () => {}
      })
    }
  };

  // Force reload of stream-route so it picks up the stubbed d-client
  delete require.cache[streamRouteId];
  const { handleStreamRequest: handleStreamRequestFresh } = require("../modules/routing/stream-route");

  const sentResponses = [];
  const sendJson = (_req, _res, status, body) => { sentResponses.push({ status, body }); };

  try {
    const result = await handleStreamRequestFresh(
      { req: { headers: {} }, res: {}, pathname: "/stream/series/tt0388629%3A1%3A1.json", ip: "127.0.0.1" },
      { sendJson, concurrencyGuard: spyGuard }
    );

    assert.equal(result.handled, true, "stream-route must handle the request");
    assert.equal(guardCalls.length, 1, "guard.execute must be called exactly once");
    assert.equal(guardCalls[0], "tt0388629:1:1", "guard.execute must be called with the episodeId as key");
  } finally {
    // Restore require.cache
    if (origStreamRoute) {
      require.cache[streamRouteId] = origStreamRoute;
    } else {
      delete require.cache[streamRouteId];
    }
    if (origDClient) {
      require.cache[dClientId] = origDClient;
    } else {
      delete require.cache[dClientId];
    }
  }
});

// Test 8 — stream-route.js uses default guard when injected.concurrencyGuard absent
test("stream-route wiring: default guard used when concurrencyGuard not injected", async () => {
  // This test confirms the module-level default guard does not crash on import.
  // It WILL FAIL until concurrency-guard.js exists, because stream-route.js will crash on require.

  const streamRouteId = require.resolve("../modules/routing/stream-route");
  const dClientId = require.resolve("../modules/integrations/d-client");
  const origStreamRoute = require.cache[streamRouteId];
  const origDClient = require.cache[dClientId];

  require.cache[dClientId] = {
    id: dClientId,
    filename: dClientId,
    loaded: true,
    exports: {
      createDClient: () => ({
        resolveEpisode: async () => ({ url: "https://example.com/test.mp4", title: "S01E01" }),
        forwardUserAgent: async () => {}
      })
    }
  };

  delete require.cache[streamRouteId];
  const { handleStreamRequest: handleStreamRequestFresh } = require("../modules/routing/stream-route");

  const sentResponses = [];
  const sendJson = (_req, _res, status, body) => { sentResponses.push({ status, body }); };

  try {
    const result = await handleStreamRequestFresh(
      { req: { headers: {} }, res: {}, pathname: "/stream/series/tt0388629%3A1%3A1.json", ip: "127.0.0.1" },
      { sendJson }
    );

    assert.equal(result.handled, true, "stream-route must handle request using default guard without crashing");
  } finally {
    if (origStreamRoute) {
      require.cache[streamRouteId] = origStreamRoute;
    } else {
      delete require.cache[streamRouteId];
    }
    if (origDClient) {
      require.cache[dClientId] = origDClient;
    } else {
      delete require.cache[dClientId];
    }
  }
});
