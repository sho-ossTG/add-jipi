const test = require("node:test");
const assert = require("node:assert/strict");
const { runAtomicSessionGate } = require("../modules/policy/session-gate");

const NOW_MS = 1_700_000_000_000;

function createSessionGateRedisEval({
  initialSessions = [],
  reconnectGraceMs = 15000,
  rotationIdleMs = 45000,
  inactivityLimitSec = 20 * 60
} = {}) {
  const sessions = new Map(initialSessions);

  return async function redisEval(_script, _keys, args = []) {
    const ip = String(args[0] || "");
    const nowMs = Number(args[1] || 0);
    const pruneCutoff = Number(args[2] || (nowMs - (inactivityLimitSec * 1000)));
    const maxSessions = Number(args[3] || 2);
    const graceMs = Number(args[5] || reconnectGraceMs);
    const idleCutoff = Number(args[6] || (nowMs - rotationIdleMs));

    for (const [member, score] of [...sessions.entries()]) {
      if (score <= pruneCutoff) {
        sessions.delete(member);
      }
    }

    if (sessions.has(ip)) {
      sessions.set(ip, nowMs);
      return [1, "admitted:existing", "", sessions.size];
    }

    if (sessions.size < maxSessions) {
      sessions.set(ip, nowMs);
      return [1, "admitted:new", "", sessions.size];
    }

    const ordered = [...sessions.entries()].sort((left, right) => {
      if (left[1] !== right[1]) return left[1] - right[1];
      return left[0].localeCompare(right[0]);
    });
    let rotatedIp = "";
    let rotatedScore = Number.POSITIVE_INFINITY;

    for (const [member, score] of ordered) {
      const idleEnough = score <= idleCutoff;
      const outsideGrace = (nowMs - score) >= graceMs;
      if (member === ip || !idleEnough || !outsideGrace) {
        continue;
      }
      if (score < rotatedScore || (score === rotatedScore && member.localeCompare(rotatedIp) < 0)) {
        rotatedIp = member;
        rotatedScore = score;
      }
    }

    if (rotatedIp) {
      sessions.delete(rotatedIp);
      sessions.set(ip, nowMs);
      return [1, "admitted:rotated", rotatedIp, sessions.size];
    }

    return [0, "blocked:slot_taken", "", sessions.size];
  };
}

test("session gate admits new sessions when capacity exists", async () => {
  const decision = await runAtomicSessionGate({
    redisEval: createSessionGateRedisEval(),
    ip: "198.51.100.40",
    nowMs: NOW_MS,
    maxSessions: 2
  });

  assert.deepEqual(decision, {
    allowed: true,
    reason: "admitted:new",
    rotatedIp: "",
    activeCount: 1
  });
});

test("session gate preserves existing admitted session", async () => {
  const decision = await runAtomicSessionGate({
    redisEval: createSessionGateRedisEval({
      initialSessions: [["198.51.100.41", NOW_MS - 20_000]]
    }),
    ip: "198.51.100.41",
    nowMs: NOW_MS,
    maxSessions: 2
  });

  assert.deepEqual(decision, {
    allowed: true,
    reason: "admitted:existing",
    rotatedIp: "",
    activeCount: 1
  });
});

test("session gate rotates oldest idle session when contender arrives", async () => {
  const decision = await runAtomicSessionGate({
    redisEval: createSessionGateRedisEval({
      initialSessions: [
        ["198.51.100.10", NOW_MS - 80_000],
        ["198.51.100.11", NOW_MS - 3_000]
      ]
    }),
    ip: "198.51.100.12",
    nowMs: NOW_MS,
    maxSessions: 2,
    reconnectGraceMs: 15_000,
    rotationIdleMs: 45_000
  });

  assert.deepEqual(decision, {
    allowed: true,
    reason: "admitted:rotated",
    rotatedIp: "198.51.100.10",
    activeCount: 2
  });
});

test("session gate blocks contender when active slots are still occupied", async () => {
  const decision = await runAtomicSessionGate({
    redisEval: createSessionGateRedisEval({
      initialSessions: [
        ["198.51.100.20", NOW_MS - 5_000],
        ["198.51.100.21", NOW_MS - 6_000]
      ]
    }),
    ip: "198.51.100.22",
    nowMs: NOW_MS,
    maxSessions: 2,
    reconnectGraceMs: 15_000,
    rotationIdleMs: 45_000
  });

  assert.deepEqual(decision, {
    allowed: false,
    reason: "blocked:slot_taken",
    rotatedIp: "",
    activeCount: 2
  });
});
