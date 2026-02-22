const test = require("node:test");
const assert = require("node:assert/strict");
const { runAtomicSessionGate } = require("../modules/policy/session-gate");
const { createSessionGateRedisEval } = require("./helpers/runtime-fixtures");

const NOW_MS = 1_700_000_000_000;

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
