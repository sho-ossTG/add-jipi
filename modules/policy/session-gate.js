const DEFAULTS = Object.freeze({
  sessionsKey: "system:active_sessions",
  inactivityLimitSec: 20 * 60,
  maxSessions: 2,
  slotTtlSec: 3600,
  reconnectGraceMs: 15000,
  rotationIdleMs: 45000
});

const SESSION_GATE_SCRIPT = `
  local sessions = KEYS[1]
  local currentIp = ARGV[1]
  local nowMs = tonumber(ARGV[2])
  local pruneCutoff = tonumber(ARGV[3])
  local maxSessions = tonumber(ARGV[4])
  local slotTtlSec = tonumber(ARGV[5])
  local reconnectGraceMs = tonumber(ARGV[6])
  local idleCutoff = tonumber(ARGV[7])

  redis.call("ZREMRANGEBYSCORE", sessions, "-inf", tostring(pruneCutoff))

  local existingScore = redis.call("ZSCORE", sessions, currentIp)
  if existingScore then
    redis.call("ZADD", sessions, tostring(nowMs), currentIp)
    redis.call("EXPIRE", sessions, slotTtlSec)
    return {1, "admitted:existing", "", redis.call("ZCARD", sessions)}
  end

  local activeCount = tonumber(redis.call("ZCARD", sessions))
  if activeCount < maxSessions then
    redis.call("ZADD", sessions, tostring(nowMs), currentIp)
    redis.call("EXPIRE", sessions, slotTtlSec)
    return {1, "admitted:new", "", redis.call("ZCARD", sessions)}
  end

  local members = redis.call("ZRANGE", sessions, 0, -1, "WITHSCORES")
  local rotatedIp = nil
  local rotatedScore = nil

  for i = 1, #members, 2 do
    local candidateIp = members[i]
    local candidateScore = tonumber(members[i + 1])
    if candidateIp ~= currentIp then
      local idleEnough = candidateScore <= idleCutoff
      local outsideGrace = (nowMs - candidateScore) >= reconnectGraceMs
      if idleEnough and outsideGrace then
        if (not rotatedScore) or (candidateScore < rotatedScore) or (candidateScore == rotatedScore and candidateIp < rotatedIp) then
          rotatedIp = candidateIp
          rotatedScore = candidateScore
        end
      end
    end
  end

  if rotatedIp then
    redis.call("ZREM", sessions, rotatedIp)
    redis.call("ZADD", sessions, tostring(nowMs), currentIp)
    redis.call("EXPIRE", sessions, slotTtlSec)
    return {1, "admitted:rotated", rotatedIp, redis.call("ZCARD", sessions)}
  end

  return {0, "blocked:slot_taken", "", activeCount}
`;

async function runAtomicSessionGate(input) {
  const {
    redisEval,
    ip,
    nowMs = Date.now(),
    sessionsKey = DEFAULTS.sessionsKey,
    inactivityLimitSec = DEFAULTS.inactivityLimitSec,
    maxSessions = DEFAULTS.maxSessions,
    slotTtlSec = DEFAULTS.slotTtlSec,
    reconnectGraceMs = DEFAULTS.reconnectGraceMs,
    rotationIdleMs = DEFAULTS.rotationIdleMs
  } = input || {};

  if (typeof redisEval !== "function") {
    throw new Error("runAtomicSessionGate requires redisEval function");
  }

  const clientIp = String(ip || "").trim();
  if (!clientIp) {
    throw new Error("runAtomicSessionGate requires ip");
  }

  const gateResult = await redisEval(SESSION_GATE_SCRIPT, [sessionsKey], [
    clientIp,
    String(nowMs),
    String(nowMs - (inactivityLimitSec * 1000)),
    String(maxSessions),
    String(slotTtlSec),
    String(reconnectGraceMs),
    String(nowMs - rotationIdleMs)
  ]);

  if (!Array.isArray(gateResult) || gateResult.length < 2) {
    const err = new Error("Invalid atomic gate response");
    err.code = "redis_gate_invalid";
    throw err;
  }

  return {
    allowed: Number(gateResult[0]) === 1,
    reason: String(gateResult[1] || ""),
    rotatedIp: gateResult[2] ? String(gateResult[2]) : "",
    activeCount: Number(gateResult[3] || 0)
  };
}

module.exports = {
  SESSION_GATE_SCRIPT,
  runAtomicSessionGate
};
