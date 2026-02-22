const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createJerusalemClock,
  getJerusalemInfo,
  isWithinShutdownWindow
} = require("../modules/policy/time-window");
const { withFixedJerusalemTime } = require("./helpers/runtime-fixtures");

test("shutdown window boundaries are deterministic at exact Jerusalem times", () => {
  const cases = [
    { label: "00:00", hour: 0, minute: 0, expected: true },
    { label: "00:59", hour: 0, minute: 59, expected: true },
    { label: "01:00", hour: 1, minute: 0, expected: true },
    { label: "07:59", hour: 7, minute: 59, expected: true },
    { label: "08:00", hour: 8, minute: 0, expected: false }
  ];

  for (const entry of cases) {
    const inWindow = isWithinShutdownWindow({ hour: entry.hour, minute: entry.minute });
    assert.equal(
      inWindow,
      entry.expected,
      `expected ${entry.label} to be ${entry.expected ? "inside" : "outside"} shutdown window`
    );
  }
});

test("Jerusalem info extraction uses injected clock deterministically", async () => {
  await withFixedJerusalemTime(async () => {
    const clock = createJerusalemClock({
      now: () => new Date("2099-01-01T10:00:00.000Z")
    });
    const info = getJerusalemInfo(clock);

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
