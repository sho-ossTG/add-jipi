const test = require("node:test");
const assert = require("node:assert/strict");

const {
  acquireInFlightLock,
  buildInFlightKeys,
  createDegradedMarker,
  createStaleMarker,
  createSuccessMarker,
  parseInFlightResult,
  waitForInFlightResult,
  writeInFlightResult
} = require("../modules/routing/stream-dedup");

function createRedisCommand() {
  const store = new Map();

  return {
    store,
    async command(parts = []) {
      const op = String(parts[0] || "").toUpperCase();
      const key = String(parts[1] || "");

      if (op === "GET") {
        return store.has(key) ? store.get(key) : null;
      }

      if (op === "SET") {
        const value = String(parts[2] || "");
        const hasNx = parts.some((item) => String(item).toUpperCase() === "NX");
        if (hasNx && store.has(key)) {
          return null;
        }
        store.set(key, value);
        return "OK";
      }

      if (op === "DEL") {
        return store.delete(key) ? 1 : 0;
      }

      throw new Error(`Unsupported redis op in test: ${op}`);
    }
  };
}

test("acquireInFlightLock uses dedup lock key with NX behavior", async () => {
  const redis = createRedisCommand();

  const first = await acquireInFlightLock({
    redisCommand: redis.command,
    episodeId: "tt0388629:1:1",
    ip: "198.51.100.2",
    nowMs: 123
  });
  const second = await acquireInFlightLock({
    redisCommand: redis.command,
    episodeId: "tt0388629:1:1",
    ip: "198.51.100.2",
    nowMs: 124
  });

  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  assert.match(first.lockKey, /^dedup:lock:/);
  assert.match(first.resultKey, /^dedup:result:/);
});

test("waitForInFlightResult resolves success marker written by owner", async () => {
  const redis = createRedisCommand();
  const nowValues = [0, 50, 100, 150, 200, 250, 300];
  let nowIndex = 0;
  const now = () => nowValues[Math.min(nowIndex++, nowValues.length - 1)];
  let slept = 0;

  const waiter = waitForInFlightResult({
    redisCommand: redis.command,
    episodeId: "tt0388629:1:2",
    ip: "198.51.100.3",
    waitTimeoutMs: 500,
    pollIntervalMs: 50,
    now,
    sleep: async () => {
      slept += 1;
      if (slept === 2) {
        await writeInFlightResult({
          redisCommand: redis.command,
          episodeId: "tt0388629:1:2",
          ip: "198.51.100.3",
          marker: createSuccessMarker({
            title: "One Piece S1E2",
            url: "https://cdn.example.com/onepiece-1-2.mp4"
          })
        });
      }
    }
  });

  const marker = await waiter;
  assert.deepEqual(marker, {
    type: "success",
    title: "One Piece S1E2",
    url: "https://cdn.example.com/onepiece-1-2.mp4"
  });
});

test("parseInFlightResult supports degraded and stale markers", async () => {
  const degraded = parseInFlightResult(JSON.stringify(createDegradedMarker({ cause: "dependency_timeout" })));
  const stale = parseInFlightResult(JSON.stringify(createStaleMarker()));

  assert.deepEqual(degraded, {
    type: "degraded",
    cause: "dependency_timeout"
  });
  assert.deepEqual(stale, {
    type: "stale"
  });
});

test("waitForInFlightResult returns null on timeout", async () => {
  const redis = createRedisCommand();
  const nowValues = [0, 200, 400, 600, 800];
  let nowIndex = 0;
  const now = () => nowValues[Math.min(nowIndex++, nowValues.length - 1)];

  const marker = await waitForInFlightResult({
    redisCommand: redis.command,
    episodeId: "tt0388629:1:3",
    ip: "198.51.100.4",
    waitTimeoutMs: 300,
    pollIntervalMs: 50,
    now,
    sleep: async () => {}
  });

  assert.equal(marker, null);
});

test("buildInFlightKeys keeps same episode+ip namespace", () => {
  const keys = buildInFlightKeys("tt0388629:1:4", "198.51.100.5");
  assert.equal(keys.lockKey, "dedup:lock:tt0388629%3A1%3A4:198.51.100.5");
  assert.equal(keys.resultKey, "dedup:result:tt0388629%3A1%3A4:198.51.100.5");
});
