// Phase 43-01: RED tests for cache module behaviors. All tests MUST FAIL until
// modules/integrations/cache.js is created in plan 43-01 GREEN phase.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCache, defaultCache } = require("../modules/integrations/cache");

// T1: get() on empty store returns { hit: false }
test("get() returns { hit: false } on empty store", () => {
  let fakeNow = 1000;
  const cache = createCache({ positiveTtlMs: 100, staleWindowMs: 50, negativeTtlMs: 30, nowFn: () => fakeNow });
  const result = cache.get("x");
  assert.deepEqual(result, { hit: false });
});

// T2: set() then get() within TTL returns { hit: true, value, stale: false }
test("set() then get() within TTL returns { hit: true, value, stale: false }", () => {
  let fakeNow = 1000;
  const cache = createCache({ positiveTtlMs: 100, staleWindowMs: 50, negativeTtlMs: 30, nowFn: () => fakeNow });
  cache.set("x", "v");
  const result = cache.get("x");
  assert.deepEqual(result, { hit: true, value: "v", stale: false });
});

// T3: get() after TTL but within stale window returns { hit: true, value, stale: true }
test("get() after TTL but within stale window returns { hit: true, value, stale: true }", () => {
  let fakeNow = 1000;
  const cache = createCache({ positiveTtlMs: 100, staleWindowMs: 50, negativeTtlMs: 30, nowFn: () => fakeNow });
  cache.set("x", "v");
  fakeNow = 1000 + 101; // just past positiveTtlMs=100
  const result = cache.get("x");
  assert.deepEqual(result, { hit: true, value: "v", stale: true });
});

// T4: get() after TTL + stale window both elapsed returns { hit: false }
test("get() after TTL + stale window both expired returns { hit: false }", () => {
  let fakeNow = 1000;
  const cache = createCache({ positiveTtlMs: 100, staleWindowMs: 50, negativeTtlMs: 30, nowFn: () => fakeNow });
  cache.set("x", "v");
  fakeNow = 1000 + 151; // past positiveTtlMs=100 + staleWindowMs=50
  const result = cache.get("x");
  assert.deepEqual(result, { hit: false });
});

// T5: setNegative() then get() within negative TTL returns { hit: true, negative: true }
test("setNegative() then get() within negative TTL returns { hit: true, negative: true }", () => {
  let fakeNow = 1000;
  const cache = createCache({ positiveTtlMs: 100, staleWindowMs: 50, negativeTtlMs: 30, nowFn: () => fakeNow });
  cache.setNegative("x");
  const result = cache.get("x");
  assert.deepEqual(result, { hit: true, negative: true });
});

// T6: get() after negative TTL elapsed returns { hit: false }
test("get() after negative TTL elapsed returns { hit: false }", () => {
  let fakeNow = 1000;
  const cache = createCache({ positiveTtlMs: 100, staleWindowMs: 50, negativeTtlMs: 30, nowFn: () => fakeNow });
  cache.setNegative("x");
  fakeNow = 1000 + 31; // past negativeTtlMs=30
  const result = cache.get("x");
  assert.deepEqual(result, { hit: false });
});

// T7: set() overwrites existing entry (SWR refresh pattern)
test("set() overwrites existing entry so get() returns latest value", () => {
  let fakeNow = 1000;
  const cache = createCache({ positiveTtlMs: 100, staleWindowMs: 50, negativeTtlMs: 30, nowFn: () => fakeNow });
  cache.set("x", "first");
  cache.set("x", "second");
  const result = cache.get("x");
  assert.deepEqual(result, { hit: true, value: "second", stale: false });
});

// T8: defaultCache is a non-null object with get, set, setNegative methods
test("defaultCache is exported and has get, set, setNegative methods", () => {
  assert.ok(defaultCache !== null && typeof defaultCache === "object", "defaultCache must be a non-null object");
  assert.equal(typeof defaultCache.get, "function", "defaultCache.get must be a function");
  assert.equal(typeof defaultCache.set, "function", "defaultCache.set must be a function");
  assert.equal(typeof defaultCache.setNegative, "function", "defaultCache.setNegative must be a function");
});

// T9: cache hit (non-stale) — resolveEpisode is NOT called, sendJson called with cached data
test("stream-route wiring: cache hit (non-stale) skips D call and calls sendJson with cached data", async () => {
  const { handleStreamRequest } = require("../modules/routing/stream-route");

  let fakeNow = 1000;
  const streamCache = createCache({ positiveTtlMs: 10000, staleWindowMs: 5000, negativeTtlMs: 3000, nowFn: () => fakeNow });
  streamCache.set("tt0388629:1:1", { title: "Episode 1", finalUrl: "https://example.com/stream.mp4" });

  let sendJsonCalls = 0;
  const sendJson = () => { sendJsonCalls++; };

  const resolveEpisode = () => { throw new Error("resolveEpisode must not be called on cache hit"); };

  const result = await handleStreamRequest(
    { req: { headers: {} }, res: {}, pathname: "/stream/series/tt0388629%3A1%3A1.json", ip: "127.0.0.1" },
    {
      sendJson,
      streamCache,
      resolveEpisode,
      concurrencyGuard: { execute: (_key, operation) => operation() },
      forwardUserAgent: async () => {}
    }
  );

  assert.equal(result.handled, true, "result.handled must be true");
  assert.equal(result.outcome.source, "cache", "outcome.source must be cache");
  assert.equal(result.outcome.cause, "cache_hit", "outcome.cause must be cache_hit");
  assert.equal(result.outcome.result, "success", "outcome.result must be success");
  assert.equal(sendJsonCalls, 1, "sendJson must be called exactly once");
});

// T10: cache miss — resolveEpisode called, result stored in cache
test("stream-route wiring: cache miss calls D and stores result in cache", async () => {
  const { handleStreamRequest } = require("../modules/routing/stream-route");

  let fakeNow = 1000;
  const streamCache = createCache({ positiveTtlMs: 10000, staleWindowMs: 5000, negativeTtlMs: 3000, nowFn: () => fakeNow });

  let sendJsonCalls = 0;
  const sendJson = () => { sendJsonCalls++; };

  const resolveEpisode = async () => ({ url: "https://example.com/ep2.mp4", title: "Episode 2" });

  const result = await handleStreamRequest(
    { req: { headers: {} }, res: {}, pathname: "/stream/series/tt0388629%3A1%3A2.json", ip: "127.0.0.1" },
    {
      sendJson,
      streamCache,
      resolveEpisode,
      concurrencyGuard: { execute: (_key, operation) => operation() },
      forwardUserAgent: async () => {}
    }
  );

  assert.equal(result.outcome.source, "d", "outcome.source must be d");
  assert.equal(result.outcome.cause, "success", "outcome.cause must be success");
  assert.equal(sendJsonCalls, 1, "sendJson must be called");

  const afterCall = streamCache.get("tt0388629:1:2");
  assert.equal(afterCall.hit, true, "cache entry must exist after miss+store");
  assert.equal(afterCall.stale, false, "cache entry must be fresh (not stale)");
});

// T11: negative cache hit — sendDegradedStream called, D skipped
test("stream-route wiring: negative cache hit calls sendDegradedStream and skips D", async () => {
  const { handleStreamRequest } = require("../modules/routing/stream-route");

  let fakeNow = 1000;
  const streamCache = createCache({ positiveTtlMs: 10000, staleWindowMs: 5000, negativeTtlMs: 3000, nowFn: () => fakeNow });
  streamCache.setNegative("tt0388629:1:3");

  let sendDegradedCalls = 0;
  const sendDegradedStream = () => { sendDegradedCalls++; };

  const resolveEpisode = () => { throw new Error("resolveEpisode must not be called on negative cache hit"); };

  const result = await handleStreamRequest(
    { req: { headers: {} }, res: {}, pathname: "/stream/series/tt0388629%3A1%3A3.json", ip: "127.0.0.1" },
    {
      sendJson: () => {},
      sendDegradedStream,
      streamCache,
      resolveEpisode,
      concurrencyGuard: { execute: (_key, operation) => operation() },
      forwardUserAgent: async () => {}
    }
  );

  assert.equal(result.outcome.source, "cache", "outcome.source must be cache");
  assert.equal(result.outcome.cause, "cache_negative", "outcome.cause must be cache_negative");
  assert.equal(result.outcome.result, "degraded", "outcome.result must be degraded");
  assert.equal(sendDegradedCalls, 1, "sendDegradedStream must be called exactly once");
});
