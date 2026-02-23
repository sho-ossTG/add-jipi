const test = require("node:test");
const assert = require("node:assert/strict");

const {
  upsertSessionView,
  readActiveSessionCount
} = require("../modules/analytics/session-view");

function createRedisCommandMock() {
  const strings = new Map();
  const zsets = new Map();

  return async function redisCommand(command = []) {
    const op = String(command[0] || "").toUpperCase();
    const key = String(command[1] || "");

    if (op === "SET") {
      strings.set(key, String(command[2] || ""));
      return "OK";
    }

    if (op === "GET") {
      return strings.has(key) ? strings.get(key) : null;
    }

    if (op === "ZADD") {
      const score = Number(command[2] || 0);
      const member = String(command[3] || "");
      const set = zsets.get(key) || new Map();
      set.set(member, score);
      zsets.set(key, set);
      return 1;
    }

    if (op === "ZREMRANGEBYSCORE") {
      const min = Number(command[2] === "-inf" ? Number.NEGATIVE_INFINITY : command[2]);
      const max = Number(command[3] || Number.POSITIVE_INFINITY);
      const set = zsets.get(key) || new Map();
      let removed = 0;
      for (const [member, score] of set.entries()) {
        if (score >= min && score <= max) {
          set.delete(member);
          removed += 1;
        }
      }
      zsets.set(key, set);
      return removed;
    }

    if (op === "ZCARD") {
      const set = zsets.get(key) || new Map();
      return set.size;
    }

    if (op === "EXPIRE") {
      return 1;
    }

    throw new Error(`Unsupported op in mock: ${op}`);
  };
}

test("session view stores full user-agent and tracks active set with TTL pruning", async () => {
  const redisCommand = createRedisCommandMock();
  const nowMs = Date.now();
  const ttlSec = 300;
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/...";

  const stored = await upsertSessionView(redisCommand, {
    ip: "203.0.113.21",
    userAgent,
    route: "/stream/series/tt0388629%3A1%3A1.json",
    episodeId: "tt0388629:1:1",
    resolvedUrl: "https://cdn.example.com/onepiece-1-1.mp4",
    status: "resolved",
    reason: "resolved_success",
    startedAt: nowMs
  }, {
    ttlSec,
    nowMs
  });

  const payload = JSON.parse(stored.payload ? JSON.stringify(stored.payload) : "{}");
  assert.equal(payload.ip, "203.0.113.21");
  assert.equal(payload.userAgent, userAgent);
  assert.equal(payload.resolvedUrl, "https://cdn.example.com/onepiece-1-1.mp4");
  assert.equal(payload.status, "resolved");

  const activeBeforePrune = await readActiveSessionCount(redisCommand, {
    ttlSec,
    nowMs: nowMs + (ttlSec * 1000) - 1
  });
  assert.equal(activeBeforePrune, 1);

  const activeAfterPrune = await readActiveSessionCount(redisCommand, {
    ttlSec,
    nowMs: nowMs + (ttlSec * 1000) + 1
  });
  assert.equal(activeAfterPrune, 0);
});
