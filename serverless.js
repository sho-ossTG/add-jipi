const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");

const router = getRouter(addonInterface);

const IP_TTL_SECONDS = 30 * 60;
const URL_TTL_SECONDS = 30 * 60;
const SLOT_TTL_SECONDS = 60 * 60;
const GUARD_MAX_ATTEMPTS = 3;

function isDebugEnabled() {
  return process.env.DEBUG === "1";
}

function logDebug(event, details = {}) {
  if (!isDebugEnabled()) return;
  console.log(`[debug] ${event} ${JSON.stringify(details)}`);
}

function getRedisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  return { url, token };
}

async function redisCommand(command) {
  const { url, token } = getRedisConfig();

  if (!url || !token) {
    const err = new Error("Missing Upstash Redis REST configuration");
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
    err.status = response.status;
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

function getJerusalemHour(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    hour12: false
  });

  return Number(formatter.format(date));
}

function isStremioRoute(pathname) {
  if (pathname === "/manifest.json") return true;
  if (pathname.startsWith("/catalog/")) return true;
  if (pathname.startsWith("/stream/")) return true;
  return false;
}

function parseStreamRequest(pathname) {
  const match = pathname.match(/^\/stream\/([^/]+)\/([^/]+)\.json$/);
  if (!match) return null;
  return {
    type: decodeURIComponent(match[1]),
    episodeId: decodeURIComponent(match[2])
  };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function sendBlocked(res, reason, details = {}) {
  const payload = { error: "Addon temporarily unavailable", reason };
  if (isDebugEnabled()) payload.debug = details;
  sendJson(res, 503, payload);
}

function toBlockedDebug(error) {
  return {
    code: error && error.code ? error.code : "unknown",
    status: error && error.status ? error.status : undefined,
    message: error && error.message ? error.message : "unknown"
  };
}

async function getGuardAttempts(guardKey) {
  const raw = await redisCommand(["GET", guardKey]);
  const num = Number(raw || 0);
  return Number.isFinite(num) ? num : 0;
}

async function failWithGuard(guardKey, error) {
  try {
    const attempts = await redisCommand(["INCR", guardKey]);
    if (Number(attempts) === 1) {
      await redisCommand(["EXPIRE", guardKey, String(URL_TTL_SECONDS)]);
    }
  } catch {
    // Keep original redis error if guard accounting can't be written.
  }
  throw error;
}

async function writeWithGuard(command, guardKey) {
  const attempts = await getGuardAttempts(guardKey);
  if (attempts >= GUARD_MAX_ATTEMPTS) {
    const err = new Error("Storage failure: creation attempts exceeded");
    err.code = "storage_failure";
    throw err;
  }

  try {
    const result = await redisCommand(command);
    if (attempts > 0) {
      await redisCommand(["DEL", guardKey]);
    }
    return result;
  } catch (error) {
    await failWithGuard(guardKey, error);
  }
}

async function applyRequestControls(req, pathname) {
  if (!isStremioRoute(pathname)) {
    return { allowed: true, skipControls: true };
  }

  const hour = getJerusalemHour();
  if (hour === 20) {
    return { allowed: false, reason: "blocked:shutdown_window" };
  }

  const ip = getClientIp(req);
  await writeWithGuard(
    ["SET", `seen:ip:${ip}`, String(Date.now()), "EX", String(IP_TTL_SECONDS)],
    "guard:create_attempts:seen_ip"
  );

  const slotKey = "slot:accepted_ip";
  const claimResult = await writeWithGuard(
    ["SET", slotKey, ip, "EX", String(SLOT_TTL_SECONDS), "NX"],
    "guard:create_attempts:slot_ip"
  );

  if (claimResult === "OK") {
    logDebug("slot_claimed", { ip });
    return { allowed: true, ip };
  }

  const acceptedIp = await redisCommand(["GET", slotKey]);
  if (acceptedIp && acceptedIp !== ip) {
    return {
      allowed: false,
      reason: "blocked:slot_taken",
      debug: { acceptedIp, currentIp: ip }
    };
  }

  return { allowed: true, ip };
}

async function handleStreamRequest(res, pathname, ip) {
  const parsed = parseStreamRequest(pathname);
  if (!parsed || parsed.type !== "series") {
    return false;
  }

  const { episodeId } = parsed;
  if (!episodeId) {
    sendJson(res, 200, { streams: [] });
    return true;
  }

  const activeKey = `active:url:${ip}`;
  let existing = null;
  const existingRaw = await redisCommand(["GET", activeKey]);

  if (existingRaw) {
    try {
      existing = JSON.parse(existingRaw);
    } catch {
      existing = null;
    }
  }

  if (existing && existing.episodeId === episodeId && existing.url) {
    await writeWithGuard(
      ["EXPIRE", activeKey, String(URL_TTL_SECONDS)],
      "guard:create_attempts:active_url_expire"
    );
    await writeWithGuard(
      ["SET", `b_url:last:${ip}`, existing.url, "EX", String(URL_TTL_SECONDS)],
      "guard:create_attempts:b_url_last"
    );
    sendJson(res, 200, {
      streams: [
        {
          title: existing.title || "Resolved via Jipi",
          url: existing.url,
          behaviorHints: { notWebReady: true }
        }
      ]
    });
    return true;
  }

  if (typeof addonInterface.resolveEpisode !== "function") {
    const err = new Error("Missing resolver integration");
    err.code = "resolver_unavailable";
    throw err;
  }

  const resolved = await addonInterface.resolveEpisode(episodeId);
  const activePayload = {
    episodeId,
    url: resolved.url,
    updatedAt: Date.now()
  };

  await writeWithGuard(
    ["SET", activeKey, JSON.stringify(activePayload), "EX", String(URL_TTL_SECONDS)],
    "guard:create_attempts:active_url"
  );
  await writeWithGuard(
    ["SET", `b_url:last:${ip}`, resolved.url, "EX", String(URL_TTL_SECONDS)],
    "guard:create_attempts:b_url_last"
  );

  sendJson(res, 200, {
    streams: [
      {
        title: resolved.title || "Resolved via Jipi",
        url: resolved.url,
        behaviorHints: { notWebReady: true }
      }
    ]
  });
  return true;
}

module.exports = async function (req, res) {
  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = reqUrl.pathname;

  try {
    const controlResult = await applyRequestControls(req, pathname);
    if (!controlResult.allowed) {
      logDebug("request_blocked", {
        reason: controlResult.reason,
        details: controlResult.debug || null,
        path: pathname
      });
      sendBlocked(res, controlResult.reason, controlResult.debug);
      return;
    }

    if (isStremioRoute(pathname) && pathname.startsWith("/stream/")) {
      const handled = await handleStreamRequest(res, pathname, controlResult.ip || getClientIp(req));
      if (handled) return;
    }
  } catch (error) {
    const details = toBlockedDebug(error);
    logDebug("redis_control_error", { ...details, path: pathname });
    sendBlocked(res, "blocked:redis_error", details);
    return;
  }

  router(req, res, function () {
    res.statusCode = 404;
    res.end();
  });
};
