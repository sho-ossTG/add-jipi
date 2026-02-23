const {
  DEFAULT_DAILY_SUMMARY_KEY,
  writeDailySummary
} = require("./daily-summary-store");

const DEFAULT_HOURLY_KEY = "analytics:hourly";
const DEFAULT_LOCK_KEY = "daily:summary:rollup:lock";
const DEFAULT_LOCK_TTL_SEC = 180;
const META_ROLLUP_PREFIX = "__meta:rollup:";
const META_ROLLUP_STAGING_PREFIX = "__meta:rollup:staging:";

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

function buildHourlyKey(_day, _hour, options = {}) {
  return String(options.hourlyKey || DEFAULT_HOURLY_KEY).trim() || DEFAULT_HOURLY_KEY;
}

function isHourBucket(bucket = "") {
  return /^\d{4}-\d{2}-\d{2}-\d{2}$/.test(String(bucket || ""));
}

function parseHourlyFields(raw = []) {
  const hash = parseHashReply(raw);
  const byBucket = {};

  for (const [fieldName, rawValue] of Object.entries(hash)) {
    const parts = String(fieldName || "").split("|");
    if (parts.length !== 3) continue;
    const [bucket, eventName, metric] = parts;
    if (!isHourBucket(bucket) || !eventName) continue;
    if (metric !== "count" && metric !== "first_seen" && metric !== "last_seen") continue;

    if (!byBucket[bucket]) {
      byBucket[bucket] = {};
    }
    if (!byBucket[bucket][eventName]) {
      byBucket[bucket][eventName] = {
        count: 0,
        first_seen: null,
        last_seen: null
      };
    }

    if (metric === "count") {
      byBucket[bucket][eventName].count = Number(rawValue || 0);
      continue;
    }

    byBucket[bucket][eventName][metric] = String(rawValue || "") || null;
  }

  return byBucket;
}

function listFieldsForDay(raw = [], day = "") {
  const prefix = `${day}-`;
  const hash = parseHashReply(raw);
  return Object.keys(hash).filter((field) => String(field || "").startsWith(prefix));
}

function parseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

async function cleanupRolledFields(redisCommand, hourlyKeyName, fields = []) {
  if (!fields.length) return 0;
  const command = ["HDEL", hourlyKeyName, ...fields];
  const removed = await redisCommand(command);
  return Number(removed) || 0;
}

async function runNightlyRollup(redisCommand, input = {}, options = {}) {
  if (typeof redisCommand !== "function") {
    throw new Error("runNightlyRollup requires redisCommand function");
  }

  const day = normalizeDay(input.day);
  const force = Boolean(input.force);
  const dailySummaryKey = String(options.dailySummaryKey || DEFAULT_DAILY_SUMMARY_KEY).trim() || DEFAULT_DAILY_SUMMARY_KEY;
  const hourlyKeyName = String(options.hourlyKey || DEFAULT_HOURLY_KEY).trim() || DEFAULT_HOURLY_KEY;
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
    const rollupStagingField = `${META_ROLLUP_STAGING_PREFIX}${day}`;
    const existingMeta = await redisCommand(["HGET", dailySummaryKey, rollupMetaField]);
    const existingMetaJson = parseJson(existingMeta);

    if (existingMeta && !force) {
      if (existingMetaJson && existingMetaJson.cleanupDone === false) {
        const currentFieldsRaw = await redisCommand(["HGETALL", hourlyKeyName]);
        const pendingFields = listFieldsForDay(currentFieldsRaw, day);
        await cleanupRolledFields(redisCommand, hourlyKeyName, pendingFields);
        await redisCommand([
          "HSET",
          dailySummaryKey,
          rollupMetaField,
          JSON.stringify({ ...existingMetaJson, cleanupDone: true, cleanupRecoveredAt: new Date().toISOString() })
        ]);
        await redisCommand(["HDEL", dailySummaryKey, rollupStagingField]);
        return {
          status: "ok",
          reason: "cleanup_recovered",
          day
        };
      }

      return {
        status: "skipped",
        reason: "already_rolled_up",
        day
      };
    }

    const hourlyRaw = await redisCommand(["HGETALL", hourlyKeyName]);
    const byBucket = parseHourlyFields(hourlyRaw);
    const dayPrefix = `${day}-`;
    const totalsByField = {};
    let bucketsProcessed = 0;
    const dayFields = listFieldsForDay(hourlyRaw, day);

    for (const [bucket, events] of Object.entries(byBucket)) {
      if (!bucket.startsWith(dayPrefix)) continue;

      let countedBucket = false;
      for (const [eventName, eventMetrics] of Object.entries(events || {})) {
        const count = Math.max(0, Number(eventMetrics && eventMetrics.count) || 0);
        if (count <= 0) continue;
        countedBucket = true;
        totalsByField[eventName] = Number(totalsByField[eventName] || 0) + count;
      }

      if (countedBucket) {
        bucketsProcessed += 1;
      }
    }

    await redisCommand([
      "HSET",
      dailySummaryKey,
      rollupStagingField,
      JSON.stringify({
        stagedAt: new Date().toISOString(),
        day,
        hourlyKey: hourlyKeyName,
        fieldCount: dayFields.length,
        bucketsProcessed
      })
    ]);

    const summary = {
      source: "nightly_rollup",
      bucketsProcessed,
      totalsByField,
      uniqueEstimateTotal: 0,
      rolledUpAt: new Date().toISOString()
    };

    await writeDailySummary(redisCommand, day, summary, { dailySummaryKey });
    await redisCommand([
      "HSET",
      dailySummaryKey,
      rollupMetaField,
      JSON.stringify({
        rolledUpAt: new Date().toISOString(),
        cleanupDone: false,
        fieldCount: dayFields.length,
        bucketsProcessed
      })
    ]);

    await cleanupRolledFields(redisCommand, hourlyKeyName, dayFields);
    await redisCommand([
      "HSET",
      dailySummaryKey,
      rollupMetaField,
      JSON.stringify({
        rolledUpAt: new Date().toISOString(),
        cleanupDone: true,
        fieldCount: dayFields.length,
        bucketsProcessed
      })
    ]);
    await redisCommand(["HDEL", dailySummaryKey, rollupStagingField]);

    return {
      status: "ok",
      day,
      bucketsProcessed,
      uniqueEstimateTotal: 0
    };
  } finally {
    await redisCommand(["DEL", lockKey]);
  }
}

module.exports = {
  runNightlyRollup,
  buildHourlyKey,
  parseHashReply,
  parseHourlyFields
};
