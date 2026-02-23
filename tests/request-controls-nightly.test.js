const test = require("node:test");
const assert = require("node:assert/strict");

const { applyRequestControls } = require("../modules/routing/request-controls");

test("shutdown window pauses hourly writes and triggers nightly rollup for previous day", async () => {
  const calls = {
    rollup: [],
    hourly: 0
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
      timeWindow: {
        getJerusalemInfo: () => ({ hour: 2, dateStr: "2099-01-02" }),
        isWithinShutdownWindow: () => true
      },
      runNightlyRollup: async (_redisCommand, input = {}) => {
        calls.rollup.push(input.day);
        return { status: "ok", day: input.day };
      },
      trackHourlyEvent: async () => {
        calls.hourly += 1;
      }
    }
  );

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "blocked:shutdown_window");
  assert.deepEqual(calls.rollup, ["2099-01-01"]);
  assert.equal(calls.hourly, 0);
});
