const {
  DEFAULT_DAILY_SUMMARY_KEY,
  writeDailySummary
} = require("./daily-summary-store");

const DEFAULT_HOURLY_PREFIX = "analytics:hourly";
const DEFAULT_LOCK_KEY = "daily:summary:rollup:lock";
const DEFAULT_LOCK_TTL_SEC = 180;
const META_ROLLUP_PREFIX = "__meta:rollup:";

function normalizeDay(day) {
  const value = String(day || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("day must match YYYY-MM-DD");
  }
  return value;
}

function parseHashReply(raw) {
  if (!Array.isArray(raw)) {
    return {};
  }

  const output = {};
  for (let index = 0; index < raw.length; index += 2) {
    const key = String(raw[index] || "").trim();
    if (!key) continue;
    output[key] = Number(raw[index + 1] || 0);
  }
  return output;
}

function buildHourlyKey(day, hour, options = {}) {
  const prefix = String(options.hourlyPrefix || DEFAULT_HOURLY_PREFIX).trim() || DEFAULT_HOURLY_PREFIX;
  return `${prefix}:${day}-${String(hour).padStart(2, "0")}`;
}

async function runNightlyRollup(redisCommand, input = {}, options = {}) {
  if (typeof redisCommand !== "function") {
    throw new Error("runNightlyRollup requires redisCommand function");
  }

  const day = normalizeDay(input.day);
  const force = Boolean(input.force);
  const dailySummaryKey = String(options.dailySummaryKey || DEFAULT_DAILY_SUMMARY_KEY).trim() || DEFAULT_DAILY_SUMMARY_KEY;
  const lockKey = String(options.lockKey || DEFAULT_LOCK_KEY).trim() || DEFAULT_LOCK_KEY;
  const lockTtlSec = Number(options.lockTtlSec || DEFAULT_LOCK_TTL_SEC);
  const lockValue = `${process.pid}:${Date.now()}`;

  const lockResult = await redisCommand(["SET", lockKey, lockValue, "NX", "EX", String(lockTtlSec)]);
  if (!lockResult) {
    return {
      status: "skipped",
      reason: "lock_not_acquired",
      day
    };
  }

  try {
    const rollupMetaField = `${META_ROLLUP_PREFIX}${day}`;
    const existingMeta = await redisCommand(["HGET", dailySummaryKey, rollupMetaField]);
    if (existingMeta && !force) {
      return {
        status: "skipped",
        reason: "already_rolled_up",
        day
      };
    }

    const totalsByField = {};
    let uniqueEstimateTotal = 0;
    let bucketsProcessed = 0;

    for (let hour = 0; hour < 24; hour += 1) {
      const key = buildHourlyKey(day, hour, options);
      const hash = parseHashReply(await redisCommand(["HGETALL", key]));
      const fields = Object.keys(hash);
      if (!fields.length) {
        continue;
      }

      bucketsProcessed += 1;
      for (const field of fields) {
        totalsByField[field] = Number(totalsByField[field] || 0) + Number(hash[field] || 0);
      }

      const uniqKey = `${key}:uniq`;
      const uniqCount = await redisCommand(["PFCOUNT", uniqKey]);
      uniqueEstimateTotal += Math.max(0, Number(uniqCount) || 0);
    }

    const summary = {
      source: "nightly_rollup",
      bucketsProcessed,
      totalsByField,
      uniqueEstimateTotal,
      rolledUpAt: new Date().toISOString()
    };

    await writeDailySummary(redisCommand, day, summary, { dailySummaryKey });
    await redisCommand(["HSET", dailySummaryKey, rollupMetaField, JSON.stringify({ rolledUpAt: new Date().toISOString() })]);

    for (let hour = 0; hour < 24; hour += 1) {
      const key = buildHourlyKey(day, hour, options);
      await redisCommand(["DEL", key]);
      await redisCommand(["DEL", `${key}:uniq`]);
    }

    return {
      status: "ok",
      day,
      bucketsProcessed,
      uniqueEstimateTotal
    };
  } finally {
    await redisCommand(["DEL", lockKey]);
  }
}

module.exports = {
  runNightlyRollup,
  buildHourlyKey,
  parseHashReply
};
