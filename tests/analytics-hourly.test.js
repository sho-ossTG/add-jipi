const test = require("node:test");
const assert = require("node:assert/strict");

const {
  trackHourlyEvent,
  toHourBucket
} = require("../modules/analytics/hourly-tracker");

function createRedisMock() {
  const hashes = new Map();
  const hll = new Map();

  return {
    hashes,
    hll,
    async command(parts = []) {
      const op = String(parts[0] || "").toUpperCase();
      const key = String(parts[1] || "");

      if (op === "HINCRBY") {
        const field = String(parts[2] || "");
        const amount = Number(parts[3] || 0);
        const hash = hashes.get(key) || new Map();
        const next = Number(hash.get(field) || 0) + amount;
        hash.set(field, next);
        hashes.set(key, hash);
        return next;
      }

      if (op === "PFADD") {
        const member = String(parts[2] || "");
        const set = hll.get(key) || new Set();
        const before = set.size;
        set.add(member);
        hll.set(key, set);
        return set.size === before ? 0 : 1;
      }

      if (op === "EXPIRE") {
        return 1;
      }

      throw new Error(`Unsupported op in mock: ${op}`);
    }
  };
}

test("hourly tracker performs fast counter increments and unique tracking", async () => {
  const redis = createRedisMock();
  const bucket = toHourBucket({ nowMs: Date.UTC(2099, 0, 1, 14, 5, 0) });

  await trackHourlyEvent(redis.command, {
    bucket,
    fields: ["requests.total", "policy.admitted"],
    uniqueId: "198.51.100.20"
  }, { ttlSec: 600 });

  await trackHourlyEvent(redis.command, {
    bucket,
    fields: ["requests.total", "policy.admitted"],
    uniqueId: "198.51.100.20"
  }, { ttlSec: 600 });

  const hourlyKey = `analytics:hourly:${bucket}`;
  const hash = redis.hashes.get(hourlyKey);
  assert.equal(hash.get("requests.total"), 2);
  assert.equal(hash.get("policy.admitted"), 2);

  const uniq = redis.hll.get(`${hourlyKey}:uniq`);
  assert.equal(uniq.size, 1);
});
