const DEFAULT_TIME_ZONE = "Asia/Beirut";

function createBeirutClock(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const timeZone = String(options.timeZone || DEFAULT_TIME_ZONE);
  return {
    now,
    timeZone
  };
}

function getBeirutInfo(clock = createBeirutClock()) {
  const date = clock.now();
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: clock.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour12: false
  });

  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    hour: Number.parseInt(parts.hour, 10),
    minute: Number.parseInt(parts.minute, 10),
    second: Number.parseInt(parts.second, 10),
    day: Number.parseInt(parts.day, 10),
    month: Number.parseInt(parts.month, 10),
    year: Number.parseInt(parts.year, 10),
    dateStr: `${parts.year}-${parts.month}-${parts.day}`
  };
}

module.exports = {
  createBeirutClock,
  getBeirutInfo
};
