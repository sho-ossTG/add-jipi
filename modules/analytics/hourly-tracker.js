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

function hourlyKey(bucket, options = {}) {
  const prefix = String(options.prefix || "analytics:hourly").trim();
  return `${prefix}:${bucket}`;
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
  const ttlSec = Number(options.ttlSec || input.ttlSec || (36 * 3600));
  const fields = normalizeFields(input.fields);

  if (!fields.length) {
    return { key, bucket, tracked: 0 };
  }

  for (const field of fields) {
    await redisCommand(["HINCRBY", key, field, "1"]);
  }
  await redisCommand(["EXPIRE", key, String(ttlSec)]);

  if (input.uniqueId) {
    const uniqKey = `${key}:uniq`;
    await redisCommand(["PFADD", uniqKey, String(input.uniqueId)]);
    await redisCommand(["EXPIRE", uniqKey, String(ttlSec)]);
  }

  return {
    key,
    bucket,
    tracked: fields.length,
    uniqueTracked: Boolean(input.uniqueId)
  };
}

module.exports = {
  toHourBucket,
  hourlyKey,
  trackHourlyEvent
};
