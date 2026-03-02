const test = require("node:test");
const assert = require("node:assert/strict");

const { runNightlyRollup } = require("../modules/analytics/nightly-rollup");

function createRedisRuntime() {
  const strings = new Map();
  const hashes = new Map();
  const hll = new Map();

  return {
    strings,
    hashes,
    hll,
    async command(parts = []) {
      const op = String(parts[0] || "").toUpperCase();
      const key = String(parts[1] || "");

      if (op === "SET") {
        const hasNx = parts.includes("NX");
        if (hasNx && strings.has(key)) {
          return null;
        }
        strings.set(key, String(parts[2] || ""));
        return "OK";
      }

      if (op === "DEL") {
        let removed = 0;
        if (strings.delete(key)) removed += 1;
        if (hashes.delete(key)) removed += 1;
        if (hll.delete(key)) removed += 1;
        return removed;
      }

      if (op === "HSET") {
        const field = String(parts[2] || "");
        const value = String(parts[3] || "");
        const hash = hashes.get(key) || new Map();
        hash.set(field, value);
        hashes.set(key, hash);
        return 1;
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

      if (op === "HGET") {
        const field = String(parts[2] || "");
        const hash = hashes.get(key) || new Map();
        return hash.has(field) ? hash.get(field) : null;
      }

      if (op === "HGETALL") {
        const hash = hashes.get(key) || new Map();
        return Array.from(hash.entries()).flat();
      }

      if (op === "HDEL") {
        const hash = hashes.get(key) || new Map();
        let removed = 0;
        for (let index = 2; index < parts.length; index += 1) {
          const field = String(parts[index] || "");
          if (hash.delete(field)) {
            removed += 1;
          }
        }
        hashes.set(key, hash);
        return removed;
      }

      if (op === "HKEYS") {
        const hash = hashes.get(key) || new Map();
        return Array.from(hash.keys());
      }

      if (op === "PFCOUNT") {
        const set = hll.get(key) || new Set();
        return set.size;
      }

      if (op === "PFADD") {
        const member = String(parts[2] || "");
        const set = hll.get(key) || new Set();
        set.add(member);
        hll.set(key, set);
        return 1;
      }

      throw new Error(`Unsupported op in mock: ${op}`);
    }
  };
}

test("nightly rollup aggregates hourly hashes into one daily summary and cleans hourly keys", async () => {
  const redis = createRedisRuntime();
  const day = "2099-01-01";
  const hourlyKey = "analytics:hourly";
  const h14 = "2099-01-01-14";
  const h15 = "2099-01-01-15";

  await redis.command(["HSET", hourlyKey, `${h14}|requests.total|count`, "10"]);
  await redis.command(["HSET", hourlyKey, `${h14}|policy.admitted|count`, "8"]);
  await redis.command(["HSET", hourlyKey, `${h15}|requests.total|count`, "5"]);
  await redis.command(["HSET", hourlyKey, `${h15}|stream.degraded|count`, "2"]);
  await redis.command(["HSET", hourlyKey, `${h14}|requests.total|first_seen`, "2099-01-01T14:00:00.000Z"]);
  await redis.command(["HSET", hourlyKey, `${h14}|requests.total|last_seen`, "2099-01-01T14:59:00.000Z"]);
  await redis.command(["PFADD", `${hourlyKey}:unique:${h14}|requests.total`, "198.51.100.20"]);
  await redis.command(["PFADD", `${hourlyKey}:unique:${h14}|requests.total`, "198.51.100.21"]);
  await redis.command(["PFADD", `${hourlyKey}:unique:${h15}|requests.total`, "198.51.100.22"]);

  const first = await runNightlyRollup(redis.command, { day });
  assert.equal(first.status, "ok");
  assert.equal(first.bucketsProcessed, 2);

  const daily = JSON.parse((await redis.command(["HGET", "daily:summary", day])) || "{}");
  assert.equal(daily.day, day);
  assert.equal(daily.totalsByField["requests.total"], 15);
  assert.equal(daily.totalsByField["policy.admitted"], 8);
  assert.equal(daily.totalsByField["stream.degraded"], 2);
  assert.ok(Number(daily.uniqueEstimateTotal) > 0);

  const remainingHourly = await redis.command(["HGETALL", hourlyKey]);
  assert.equal(remainingHourly.length, 0);

  const second = await runNightlyRollup(redis.command, { day });
  assert.equal(second.status, "skipped");
  assert.equal(second.reason, "already_rolled_up");
});
