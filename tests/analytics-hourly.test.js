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

      if (op === "HSETNX") {
        const field = String(parts[2] || "");
        const value = String(parts[3] || "");
        const hash = hashes.get(key) || new Map();
        if (hash.has(field)) {
          return 0;
        }
        hash.set(field, value);
        hashes.set(key, hash);
        return 1;
      }

      if (op === "HSET") {
        const field = String(parts[2] || "");
        const value = String(parts[3] || "");
        const hash = hashes.get(key) || new Map();
        hash.set(field, value);
        hashes.set(key, hash);
        return 1;
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

  const hourlyKey = "analytics:hourly";
  const hash = redis.hashes.get(hourlyKey);
  assert.equal(Number(hash.get(`${bucket}|requests.total|count`)), 2);
  assert.equal(Number(hash.get(`${bucket}|policy.admitted|count`)), 2);
  assert.match(String(hash.get(`${bucket}|requests.total|first_seen`)), /^\d{4}-\d{2}-\d{2}T/);
  assert.match(String(hash.get(`${bucket}|requests.total|last_seen`)), /^\d{4}-\d{2}-\d{2}T/);

  const requestsTotalUnique = redis.hll.get(`${hourlyKey}:unique:${bucket}|requests.total`);
  const policyAdmittedUnique = redis.hll.get(`${hourlyKey}:unique:${bucket}|policy.admitted`);
  assert.equal(requestsTotalUnique && requestsTotalUnique.size, 1);
  assert.equal(policyAdmittedUnique && policyAdmittedUnique.size, 1);
});
