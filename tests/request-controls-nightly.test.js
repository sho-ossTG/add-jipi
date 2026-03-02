const test = require("node:test");
const assert = require("node:assert/strict");

const { applyRequestControls } = require("../modules/routing/request-controls");

test("shutdown window still tracks blocked policy analytics and triggers nightly rollup for previous day", async () => {
  const calls = {
    rollup: [],
    hourly: []
  };

  async function redisCommand(parts = []) {
    const op = String(parts[0] || "").toUpperCase();
    if (op === "GET") return "1";
    if (op === "SET") return "OK";
    if (op === "DEL") return 1;
    return 0;
  }

  const result = await applyRequestControls(
    {
      req: { headers: {}, socket: { remoteAddress: "198.51.100.1" } },
      pathname: "/stream/series/tt0388629%3A1%3A1.json"
    },
    {
      isStremioRoute: () => true,
      redisCommand,
      getTrustedClientIp: (request) => request && request.socket && request.socket.remoteAddress,
      timeWindow: {
        getJerusalemInfo: () => ({ hour: 2, dateStr: "2099-01-02" }),
        isWithinShutdownWindow: () => true
      },
      runNightlyRollup: async (_redisCommand, input = {}) => {
        calls.rollup.push(input.day);
        return { status: "ok", day: input.day };
      },
      trackHourlyEvent: async (_redisCommand, payload = {}) => {
        calls.hourly.push(payload);
      }
    }
  );

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "blocked:shutdown_window");
  assert.deepEqual(calls.rollup, ["2099-01-01"]);
  assert.equal(calls.hourly.length, 1);
  assert.deepEqual(calls.hourly[0].fields, [
    "requests.total",
    "policy.blocked",
    "policy.blocked:shutdown_window"
  ]);
  assert.equal(calls.hourly[0].uniqueId, "198.51.100.1");
});
