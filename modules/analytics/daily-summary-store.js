const DEFAULT_DAILY_SUMMARY_KEY = "daily:summary";
const META_PREFIX = "__meta:";

function normalizeDay(day) {
  const value = String(day || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("day must match YYYY-MM-DD");
  }
  return value;
}

function resolveSummaryKey(options = {}) {
  return String(options.dailySummaryKey || DEFAULT_DAILY_SUMMARY_KEY).trim() || DEFAULT_DAILY_SUMMARY_KEY;
}

function isMetaField(fieldName) {
  return String(fieldName || "").startsWith(META_PREFIX);
}

async function writeDailySummary(redisCommand, day, summary = {}, options = {}) {
  if (typeof redisCommand !== "function") {
    throw new Error("writeDailySummary requires redisCommand function");
  }

  const dayField = normalizeDay(day);
  const key = resolveSummaryKey(options);
  const payload = {
    day: dayField,
    generatedAt: new Date().toISOString(),
    ...summary
  };

  await redisCommand(["HSET", key, dayField, JSON.stringify(payload)]);
  await redisCommand(["HSET", key, `${META_PREFIX}last_updated`, new Date().toISOString()]);
  return {
    key,
    day: dayField,
    payload
  };
}

async function readDailySummary(redisCommand, day, options = {}) {
  if (typeof redisCommand !== "function") {
    throw new Error("readDailySummary requires redisCommand function");
  }

  const dayField = normalizeDay(day);
  const key = resolveSummaryKey(options);
  const raw = await redisCommand(["HGET", key, dayField]);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function deleteDailySummaryEntry(redisCommand, day, options = {}) {
  if (typeof redisCommand !== "function") {
    throw new Error("deleteDailySummaryEntry requires redisCommand function");
  }

  const dayField = normalizeDay(day);
  const key = resolveSummaryKey(options);
  const removed = await redisCommand(["HDEL", key, dayField]);
  return {
    key,
    day: dayField,
    removed: Number(removed) || 0
  };
}

async function listDailySummaryDays(redisCommand, options = {}) {
  if (typeof redisCommand !== "function") {
    throw new Error("listDailySummaryDays requires redisCommand function");
  }

  const key = resolveSummaryKey(options);
  const fields = await redisCommand(["HKEYS", key]);
  if (!Array.isArray(fields)) {
    return [];
  }

  return fields
    .map((field) => String(field || ""))
    .filter((field) => field && !isMetaField(field))
    .sort();
}

module.exports = {
  DEFAULT_DAILY_SUMMARY_KEY,
  writeDailySummary,
  readDailySummary,
  deleteDailySummaryEntry,
  listDailySummaryDays
};
