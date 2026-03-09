const DEFAULT_LOCK_TTL_SEC = 70;
const DEFAULT_RESULT_TTL_SEC = 70;
const DEFAULT_WAIT_TIMEOUT_MS = 70000;
const DEFAULT_POLL_INTERVAL_MS = 500;

const LOCK_KEY_PREFIX = "dedup:lock";
const RESULT_KEY_PREFIX = "dedup:result";

function toKeyPart(value) {
  return encodeURIComponent(String(value || "").trim());
}

function buildInFlightKeys(episodeId, ip) {
  const normalizedEpisodeId = toKeyPart(episodeId);
  const normalizedIp = toKeyPart(ip);
  return {
    lockKey: `${LOCK_KEY_PREFIX}:${normalizedEpisodeId}:${normalizedIp}`,
    resultKey: `${RESULT_KEY_PREFIX}:${normalizedEpisodeId}:${normalizedIp}`
  };
}

function createSuccessMarker(input = {}) {
  return {
    type: "success",
    title: String(input.title || ""),
    url: String(input.url || "")
  };
}

function createDegradedMarker(input = {}) {
  return {
    type: "degraded",
    cause: String(input.cause || "dependency_unavailable")
  };
}

function createStaleMarker() {
  return {
    type: "stale"
  };
}

function parseInFlightResult(raw) {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== "object") return null;

    if (parsed.type === "success" && String(parsed.url || "").startsWith("https://")) {
      return {
        type: "success",
        title: String(parsed.title || ""),
        url: String(parsed.url)
      };
    }

    if (parsed.type === "degraded") {
      return {
        type: "degraded",
        cause: String(parsed.cause || "dependency_unavailable")
      };
    }

    if (parsed.type === "stale") {
      return createStaleMarker();
    }

    return null;
  } catch {
    return null;
  }
}

async function acquireInFlightLock(input = {}) {
  const {
    redisCommand,
    episodeId,
    ip,
    lockTtlSec = DEFAULT_LOCK_TTL_SEC,
    nowMs = Date.now()
  } = input;

  if (typeof redisCommand !== "function") {
    throw new Error("acquireInFlightLock requires redisCommand");
  }

  const { lockKey, resultKey } = buildInFlightKeys(episodeId, ip);
  const lockValue = String(nowMs);
  const lockResult = await redisCommand([
    "SET",
    lockKey,
    lockValue,
    "NX",
    "EX",
    String(lockTtlSec)
  ]);

  const acquired = String(lockResult || "").toUpperCase() === "OK";
  if (acquired) {
    await redisCommand(["DEL", resultKey]);
  }

  return {
    acquired,
    lockKey,
    resultKey
  };
}

async function writeInFlightResult(input = {}) {
  const {
    redisCommand,
    episodeId,
    ip,
    marker,
    resultTtlSec = DEFAULT_RESULT_TTL_SEC
  } = input;

  if (typeof redisCommand !== "function") {
    throw new Error("writeInFlightResult requires redisCommand");
  }

  if (!marker || typeof marker !== "object") {
    throw new Error("writeInFlightResult requires marker payload");
  }

  const { resultKey } = buildInFlightKeys(episodeId, ip);
  await redisCommand([
    "SET",
    resultKey,
    JSON.stringify(marker),
    "EX",
    String(resultTtlSec)
  ]);
}

async function releaseInFlightLock(input = {}) {
  const {
    redisCommand,
    episodeId,
    ip
  } = input;

  if (typeof redisCommand !== "function") {
    throw new Error("releaseInFlightLock requires redisCommand");
  }

  const { lockKey } = buildInFlightKeys(episodeId, ip);
  await redisCommand(["DEL", lockKey]);
}

async function waitForInFlightResult(input = {}) {
  const {
    redisCommand,
    episodeId,
    ip,
    waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = input;

  if (typeof redisCommand !== "function") {
    throw new Error("waitForInFlightResult requires redisCommand");
  }

  const { resultKey } = buildInFlightKeys(episodeId, ip);
  const deadline = now() + Number(waitTimeoutMs || 0);

  while (now() <= deadline) {
    const raw = await redisCommand(["GET", resultKey]);
    const marker = parseInFlightResult(raw);
    if (marker) {
      return marker;
    }

    await sleep(Number(pollIntervalMs || 0));
  }

  return null;
}

module.exports = {
  LOCK_KEY_PREFIX,
  RESULT_KEY_PREFIX,
  DEFAULT_LOCK_TTL_SEC,
  DEFAULT_RESULT_TTL_SEC,
  DEFAULT_WAIT_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  buildInFlightKeys,
  createSuccessMarker,
  createDegradedMarker,
  createStaleMarker,
  parseInFlightResult,
  acquireInFlightLock,
  writeInFlightResult,
  releaseInFlightLock,
  waitForInFlightResult
};
