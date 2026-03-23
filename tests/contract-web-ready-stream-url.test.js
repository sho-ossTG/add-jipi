const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeAndClassifyStreamUrl,
  isWebReadyStreamUrl,
  formatStream
} = require("../modules/presentation/stream-payloads");
const { handleStreamRequest } = require("../modules/routing/stream-route");
const { createCache } = require("../modules/integrations/cache");

test("normalizeAndClassifyStreamUrl accepts https mp4 URLs", () => {
  const result = normalizeAndClassifyStreamUrl("https://cdn.example.com/video.mp4?range=0-1");
  assert.equal(result.isWebReady, true);
  assert.equal(result.url.includes("range="), false);
});

test("normalizeAndClassifyStreamUrl rejects webm/m3u8 and non-https", () => {
  assert.equal(isWebReadyStreamUrl("https://cdn.example.com/master.m3u8"), false);
  assert.equal(isWebReadyStreamUrl("https://cdn.example.com/video.webm"), false);
  assert.equal(isWebReadyStreamUrl("http://cdn.example.com/video.mp4"), true);
  assert.equal(isWebReadyStreamUrl("not a url"), false);
});

test("formatStream sets notWebReady based on URL policy", () => {
  const webReady = formatStream("ok", "https://cdn.example.com/video.mp4");
  const nonWebReady = formatStream("bad", "https://cdn.example.com/master.m3u8");

  assert.equal(webReady.behaviorHints.notWebReady, false);
  assert.equal(nonWebReady.behaviorHints.notWebReady, true);
});

test("stream route degrades when cache contains non-web-ready url", async () => {
  let fakeNow = 1000;
  const streamCache = createCache({ positiveTtlMs: 10000, staleWindowMs: 5000, negativeTtlMs: 3000, nowFn: () => fakeNow });
  streamCache.set("tt0388629:1:1", { title: "Episode 1", finalUrl: "https://cdn.example.com/master.m3u8" });

  let degradedCalled = 0;
  const sendDegradedStream = () => {
    degradedCalled += 1;
  };

  const result = await handleStreamRequest(
    { req: { headers: {} }, res: {}, pathname: "/stream/series/tt0388629%3A1%3A1.json", ip: "127.0.0.1" },
    {
      sendJson: () => {
        throw new Error("sendJson must not run for non-web-ready cache hit");
      },
      streamCache,
      sendDegradedStream,
      resolveEpisode: async () => ({ url: "https://cdn.example.com/video.mp4", title: "Episode 1" }),
      concurrencyGuard: { execute: async (_key, operation) => operation() },
      forwardUserAgent: async () => {}
    }
  );

  assert.equal(degradedCalled, 1);
  assert.equal(result.handled, true);
  assert.equal(result.outcome.cause, "cache_invalid_stream_url");
  assert.equal(result.outcome.result, "degraded");
});
