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

async function trackHourlyEvent(redisCommand, input = {}, options = {}) {
  if (typeof redisCommand !== "function") {
    throw new Error("trackHourlyEvent requires redisCommand function");
  }

  const bucket = toHourBucket(input);
  const key = hourlyKey(bucket, options);
  const fields = normalizeFields(input.fields);
  const nowIso = new Date(Number(input.nowMs || Date.now())).toISOString();

  if (input.pauseWrites) {
    return { key, bucket, tracked: 0, paused: true };
  }

  if (!fields.length) {
    return { key, bucket, tracked: 0 };
  }

  for (const field of fields) {
    const countField = `${bucket}|${field}|count`;
    const firstSeenField = `${bucket}|${field}|first_seen`;
    const lastSeenField = `${bucket}|${field}|last_seen`;

    await redisCommand(["HINCRBY", key, countField, "1"]);
    await redisCommand(["HSETNX", key, firstSeenField, nowIso]);
    await redisCommand(["HSET", key, lastSeenField, nowIso]);
  }

  return {
    key,
    bucket,
    tracked: fields.length,
    uniqueTracked: false
  };
}

module.exports = {
  toHourBucket,
  hourlyKey,
  trackHourlyEvent
};
