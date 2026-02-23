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

      if (op === "HGET") {
        const field = String(parts[2] || "");
        const hash = hashes.get(key) || new Map();
        return hash.has(field) ? hash.get(field) : null;
      }

      if (op === "HGETALL") {
        const hash = hashes.get(key) || new Map();
        return Array.from(hash.entries()).flat();
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
  const h14 = "analytics:hourly:2099-01-01-14";
  const h15 = "analytics:hourly:2099-01-01-15";

  await redis.command(["HSET", h14, "requests.total", "10"]);
  await redis.command(["HSET", h14, "policy.admitted", "8"]);
  await redis.command(["HSET", h15, "requests.total", "5"]);
  await redis.command(["HSET", h15, "stream.degraded", "2"]);
  await redis.command(["PFADD", `${h14}:uniq`, "u1"]);
  await redis.command(["PFADD", `${h14}:uniq`, "u2"]);
  await redis.command(["PFADD", `${h15}:uniq`, "u3"]);

  const first = await runNightlyRollup(redis.command, { day });
  assert.equal(first.status, "ok");
  assert.equal(first.bucketsProcessed, 2);

  const daily = JSON.parse((await redis.command(["HGET", "daily:summary", day])) || "{}");
  assert.equal(daily.day, day);
  assert.equal(daily.totalsByField["requests.total"], 15);
  assert.equal(daily.totalsByField["policy.admitted"], 8);
  assert.equal(daily.totalsByField["stream.degraded"], 2);

  assert.equal((await redis.command(["HGETALL", h14])).length, 0);
  assert.equal((await redis.command(["HGETALL", h15])).length, 0);

  const second = await runNightlyRollup(redis.command, { day });
  assert.equal(second.status, "skipped");
  assert.equal(second.reason, "already_rolled_up");
});
