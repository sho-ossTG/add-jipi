const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");

const router = getRouter(addonInterface);

// Constants
const SLOT_TTL = 3600; // 1 hour rolling
const INACTIVITY_LIMIT = 20 * 60; // 20 minutes
const ACTIVE_URL_TTL = 3600 * 2; // 2 hours (enough to survive inactivity for cleanup)

function getRedisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  return { url, token };
}

async function redisCommand(command) {
  const { url, token } = getRedisConfig();
  if (!url || !token) {
    const err = new Error("Missing Redis configuration");
    err.code = "redis_config_missing";
    throw err;
  }

  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify([command])
  });

  if (!response.ok) {
    const err = new Error(`Redis request failed with status ${response.status}`);
    err.code = "redis_http_error";
    throw err;
  }

  const data = await response.json();
  const item = Array.isArray(data) ? data[0] : null;

  if (!item || item.error) {
    const err = new Error(item && item.error ? item.error : "Invalid Redis response");
    err.code = "redis_response_error";
    throw err;
  }

  return item.result;
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    return xff.split(",")[0].trim();
  }
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) {
    return realIp.trim();
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function getJerusalemInfo() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour12: false
  });
  const parts = formatter.formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return {
    hour: parseInt(parts.hour),
    minute: parseInt(parts.minute),
    second: parseInt(parts.second),
    day: parseInt(parts.day),
    month: parseInt(parts.month),
    year: parseInt(parts.year),
    dateStr: `${parts.year}-${parts.month}-${parts.day}`
  };
}

function getSecondsToJerusalem0100() {
  const info = getJerusalemInfo();
  let diffHours = 1 - info.hour;
  if (diffHours <= 0) diffHours += 24;
  const secondsSpentInCurrentHour = info.minute * 60 + info.second;
  return diffHours * 3600 - secondsSpentInCurrentHour;
}

function isStremioRoute(pathname) {
  return pathname === "/manifest.json" || pathname.startsWith("/catalog/") || pathname.startsWith("/stream/");
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function applyRequestControls(req, pathname) {
  if (!isStremioRoute(pathname)) return { allowed: true };

  const jInfo = getJerusalemInfo();

  // 1. Blocked Hours (20:00-21:00 Israel)
  if (jInfo.hour === 20) {
    return { allowed: false, reason: "blocked:shutdown_window" };
  }

  // 2. Daily Reset (01:00)
  const todayResetKey = `system:reset:${jInfo.dateStr}`;
  if (jInfo.hour >= 1) {
    const alreadyReset = await redisCommand(["GET", todayResetKey]);
    if (!alreadyReset) {
      await redisCommand(["DEL", "quarantine:events"]);
      await redisCommand(["SET", todayResetKey, "1", "EX", "86400"]);
    }
  }

  const ip = getClientIp(req);
  const slotKey = "slot:active_ip";
  const activeIp = await redisCommand(["GET", slotKey]);

  if (activeIp && activeIp !== ip) {
    const lastSeen = await redisCommand(["GET", `active:last_seen:${activeIp}`]);
    if (!lastSeen) {
      // Inactive - Move to Archive
      const urlData = await redisCommand(["GET", `active:url:${activeIp}`]);
      if (urlData) {
        const ttl0100 = getSecondsToJerusalem0100();
        await redisCommand(["SET", `archive:url:${activeIp}`, urlData, "EX", String(ttl0100)]);
        await redisCommand(["SET", `archive:last_seen:${activeIp}`, "stale", "EX", String(ttl0100)]);
      }
      // Cleanup & Take Slot
      await redisCommand(["DEL", `active:url:${activeIp}`, `active:last_seen:${activeIp}`, slotKey]);
      await redisCommand(["SET", slotKey, ip, "EX", String(SLOT_TTL)]);
    } else {
      return {
        allowed: false,
        reason: "blocked:slot_taken",
        debug: { activeIp, currentIp: ip }
      };
    }
  } else if (!activeIp) {
    await redisCommand(["SET", slotKey, ip, "EX", String(SLOT_TTL)]);
  }

  // Refresh slot TTL (Rolling)
  await redisCommand(["EXPIRE", slotKey, String(SLOT_TTL)]);

  return { allowed: true, ip };
}

async function handleStreamRequest(res, pathname, ip) {
  const match = pathname.match(/^\/stream\/([^/]+)\/([^/]+)\.json$/);
  if (!match || match[1] !== "series") return false;
  
  const episodeId = decodeURIComponent(match[2]);
  const activeUrlKey = `active:url:${ip}`;
  const lastSeenKey = `active:last_seen:${ip}`;

  // Check cache for same episode
  const existingRaw = await redisCommand(["GET", activeUrlKey]);
  if (existingRaw) {
    try {
      const existing = JSON.parse(existingRaw);
      if (existing.episodeId === episodeId) {
        await redisCommand(["SET", lastSeenKey, String(Date.now()), "EX", String(INACTIVITY_LIMIT)]);
        sendJson(res, 200, {
          streams: [{
            title: existing.title || "Resolved via Jipi",
            url: existing.url,
            behaviorHints: { notWebReady: true }
          }]
        });
        return true;
      }
    } catch (e) {
      // Invalid JSON, treat as missing
    }
  }

  // Resolve via B
  try {
    const resolved = await addonInterface.resolveEpisode(episodeId);
    const payload = {
      url: resolved.url,
      episodeId,
      title: resolved.title,
      updatedAt: Date.now()
    };
    
    // Overwrite URL and update last_seen
    await redisCommand(["SET", activeUrlKey, JSON.stringify(payload), "EX", String(ACTIVE_URL_TTL)]);
    await redisCommand(["SET", lastSeenKey, String(Date.now()), "EX", String(INACTIVITY_LIMIT)]);

    sendJson(res, 200, {
      streams: [{
        title: resolved.title || "Resolved via Jipi",
        url: resolved.url,
        behaviorHints: { notWebReady: true }
      }]
    });
    return true;
  } catch (err) {
    const event = {
      ip,
      error: err.message,
      episodeId,
      time: new Date().toISOString()
    };
    try {
      await redisCommand(["LPUSH", "quarantine:events", JSON.stringify(event)]);
      await redisCommand(["LTRIM", "quarantine:events", "0", "49"]);
    } catch (redisErr) {
      // Ignore quarantine write errors to not mask the original B error
    }
    throw err;
  }
}

module.exports = async function (req, res) {
  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = reqUrl.pathname;

  try {
    const controlResult = await applyRequestControls(req, pathname);
    if (!controlResult.allowed) {
      sendJson(res, 503, {
        error: "Addon temporarily unavailable",
        reason: controlResult.reason
      });
      return;
    }

    if (pathname.startsWith("/stream/")) {
      const handled = await handleStreamRequest(res, pathname, controlResult.ip || getClientIp(req));
      if (handled) return;
    }
  } catch (error) {
    sendJson(res, 503, {
      error: "Addon error",
      message: error.message
    });
    return;
  }

  router(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
};
