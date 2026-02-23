const crypto = require("node:crypto");

const DEFAULT_SESSION_TTL_SEC = 20 * 60;
const DEFAULT_ACTIVE_INDEX_KEY = "sessions:view:active";
const DEFAULT_SESSION_KEY_PREFIX = "sessions:view";

function normalizeText(value) {
  return String(value || "").trim();
}

function buildSessionIdentity(ip, userAgent) {
  const normalizedIp = normalizeText(ip) || "unknown";
  const normalizedUserAgent = normalizeText(userAgent) || "unknown";
  return crypto
    .createHash("sha256")
    .update(`${normalizedIp}\n${normalizedUserAgent}`)
    .digest("hex");
}

function buildSessionViewKey(sessionId, options = {}) {
  const prefix = normalizeText(options.sessionKeyPrefix) || DEFAULT_SESSION_KEY_PREFIX;
  return `${prefix}:${sessionId}`;
}

async function upsertSessionView(redisCommand, input = {}, options = {}) {
  if (typeof redisCommand !== "function") {
    throw new Error("upsertSessionView requires redisCommand function");
  }

  const nowMs = Number(options.nowMs || Date.now());
  const ttlSec = Number(options.ttlSec || DEFAULT_SESSION_TTL_SEC);
  const ip = normalizeText(input.ip) || "unknown";
  const userAgent = normalizeText(input.userAgent) || "unknown";
  const sessionId = buildSessionIdentity(ip, userAgent);
  const sessionKey = buildSessionViewKey(sessionId, options);
  const activeIndexKey = normalizeText(options.activeIndexKey) || DEFAULT_ACTIVE_INDEX_KEY;
  const startedAt = Number(input.startedAt || nowMs);

  const payload = {
    sessionId,
    ip,
    userAgent,
    route: normalizeText(input.route),
    episodeId: normalizeText(input.episodeId),
    resolvedUrl: normalizeText(input.resolvedUrl),
    title: normalizeText(input.title),
    status: normalizeText(input.status),
    reason: normalizeText(input.reason),
    firstSeen: new Date(startedAt).toISOString(),
    lastSeen: new Date(nowMs).toISOString(),
    lastSeenMs: nowMs,
    correlationId: normalizeText(input.correlationId)
  };

  await redisCommand(["SET", sessionKey, JSON.stringify(payload), "EX", String(ttlSec)]);
  await redisCommand(["ZADD", activeIndexKey, String(nowMs), sessionId]);
  await redisCommand(["ZREMRANGEBYSCORE", activeIndexKey, "-inf", String(nowMs - (ttlSec * 1000))]);
  await redisCommand(["EXPIRE", activeIndexKey, String(ttlSec)]);

  return {
    sessionId,
    sessionKey,
    activeIndexKey,
    payload
  };
}

async function readActiveSessionCount(redisCommand, options = {}) {
  if (typeof redisCommand !== "function") {
    throw new Error("readActiveSessionCount requires redisCommand function");
  }

  const nowMs = Number(options.nowMs || Date.now());
  const ttlSec = Number(options.ttlSec || DEFAULT_SESSION_TTL_SEC);
  const activeIndexKey = normalizeText(options.activeIndexKey) || DEFAULT_ACTIVE_INDEX_KEY;

  await redisCommand(["ZREMRANGEBYSCORE", activeIndexKey, "-inf", String(nowMs - (ttlSec * 1000))]);
  const count = await redisCommand(["ZCARD", activeIndexKey]);
  return Math.max(0, Number(count) || 0);
}

module.exports = {
  buildSessionIdentity,
  buildSessionViewKey,
  upsertSessionView,
  readActiveSessionCount
};
