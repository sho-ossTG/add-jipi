function toHourBucket(input = {}) {
  if (input && typeof input.bucket === "string" && input.bucket.trim()) {
    return input.bucket.trim();
  }

  const nowMs = Number(input && input.nowMs ? input.nowMs : Date.now());
  const date = new Date(nowMs);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${year}-${month}-${day}-${hour}`;
}

function hourlyKey(_bucket, options = {}) {
  return String(options.key || "analytics:hourly").trim() || "analytics:hourly";
}

function normalizeFields(fields = []) {
  if (!Array.isArray(fields)) return [];
  return fields
    .map((field) => String(field || "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

function buildUniqueHllKey(bucket, field, options = {}) {
  const baseKey = hourlyKey(bucket, options);
  const prefix = String(options.uniqueKeyPrefix || `${baseKey}:unique`).trim() || `${baseKey}:unique`;
  return `${prefix}:${bucket}|${field}`;
}

async function trackHourlyEvent(redisCommand, input = {}, options = {}) {
  if (typeof redisCommand !== "function") {
    throw new Error("trackHourlyEvent requires redisCommand function");
  }

  const bucket = toHourBucket(input);
  const key = hourlyKey(bucket, options);
  const fields = normalizeFields(input.fields);
  const uniqueId = String(input.uniqueId || "").trim();
  const ttlSec = Math.max(0, Number(input.ttlSec || options.ttlSec || 0) || 0);
  const nowIso = new Date(Number(input.nowMs || Date.now())).toISOString();

  if (input.pauseWrites) {
    return { key, bucket, tracked: 0, paused: true };
  }

  if (!fields.length) {
    return { key, bucket, tracked: 0 };
  }

  let uniqueTracked = false;
  for (const field of fields) {
    const countField = `${bucket}|${field}|count`;
    const firstSeenField = `${bucket}|${field}|first_seen`;
    const lastSeenField = `${bucket}|${field}|last_seen`;

    await redisCommand(["HINCRBY", key, countField, "1"]);
    await redisCommand(["HSETNX", key, firstSeenField, nowIso]);
    await redisCommand(["HSET", key, lastSeenField, nowIso]);

    if (uniqueId) {
      const uniqueKey = buildUniqueHllKey(bucket, field, options);
      await redisCommand(["PFADD", uniqueKey, uniqueId]);
      if (ttlSec > 0) {
        await redisCommand(["EXPIRE", uniqueKey, String(Math.floor(ttlSec))]);
      }
      uniqueTracked = true;
    }
  }

  return {
    key,
    bucket,
    tracked: fields.length,
    uniqueTracked
  };
}

module.exports = {
  toHourBucket,
  hourlyKey,
  buildUniqueHllKey,
  trackHourlyEvent
};
