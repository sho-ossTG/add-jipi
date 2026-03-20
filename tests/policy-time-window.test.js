const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createBeirutClock,
  getBeirutInfo
} = require("../modules/policy/time-window");
const { withFixedJerusalemTime } = require("./helpers/runtime-fixtures");

test("Beirut info extraction uses injected clock deterministically", async () => {
  await withFixedJerusalemTime(async () => {
    const clock = createBeirutClock({
      now: () => new Date("2099-01-01T10:00:00.000Z")
    });
    const info = getBeirutInfo(clock);

    assert.equal(info.hour, 2);
    assert.equal(info.minute, 30);
    assert.equal(info.second, 5);
    assert.equal(info.dateStr, "2099-01-01");
  }, {
    hour: "02",
    minute: "30",
    second: "05"
  });
});
