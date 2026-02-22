const DEFAULT_TIME_ZONE = "Asia/Jerusalem";
const DEFAULT_SHUTDOWN_START_HOUR = 0;
const DEFAULT_SHUTDOWN_END_HOUR = 8;

function createJerusalemClock(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const timeZone = String(options.timeZone || DEFAULT_TIME_ZONE);
  return {
    now,
    timeZone
  };
}

function getJerusalemInfo(clock = createJerusalemClock()) {
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

function isWithinShutdownWindow(info, options = {}) {
  const startHour = Number.parseInt(String(options.startHour ?? DEFAULT_SHUTDOWN_START_HOUR), 10);
  const endHour = Number.parseInt(String(options.endHour ?? DEFAULT_SHUTDOWN_END_HOUR), 10);
  if (!info || !Number.isFinite(info.hour)) {
    return false;
  }

  if (startHour === endHour) {
    return true;
  }

  if (startHour < endHour) {
    return info.hour >= startHour && info.hour < endHour;
  }

  return info.hour >= startHour || info.hour < endHour;
}

module.exports = {
  createJerusalemClock,
  getJerusalemInfo,
  isWithinShutdownWindow
};
