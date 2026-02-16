const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");

const router = getRouter(addonInterface);

const IP_TTL_SECONDS = 30 * 60;
const URL_TTL_SECONDS = 30 * 60;
const SLOT_TTL_SECONDS = 60 * 60;

function getRedisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  return { url, token };
}

async function redisCommand(command) {
  const { url, token } = getRedisConfig();

  if (!url || !token) {
    throw new Error("Missing Upstash Redis REST configuration");
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
    throw new Error(`Redis request failed with status ${response.status}`);
  }

  const data = await response.json();
  const item = Array.isArray(data) ? data[0] : null;

  if (!item || item.error) {
    throw new Error(item && item.error ? item.error : "Invalid Redis response");
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

function getRequestUrl(req) {
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto =
    typeof protoHeader === "string" && protoHeader.trim()
      ? protoHeader.split(",")[0].trim()
      : "https";
  const host = req.headers.host || "";
  return `${proto}://${host}${req.url || ""}`;
}

function getJerusalemHour(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    hour12: false
  });

  const hour = formatter.format(date);
  return Number(hour);
}

function sendBlocked(res, message) {
  res.statusCode = 503;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: message }));
}

async function applyRequestControls(req) {
  const hour = getJerusalemHour();
  if (hour === 20) {
    return { allowed: false, message: "Addon temporarily unavailable" };
  }

  const ip = getClientIp(req);
  const requestUrl = getRequestUrl(req);

  await redisCommand(["SET", `seen_ip:${ip}`, String(Date.now()), "EX", String(IP_TTL_SECONDS)]);
  await redisCommand([
    "SET",
    `req_url:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
    requestUrl,
    "EX",
    String(URL_TTL_SECONDS)
  ]);

  const slotKey = "slot:accepted_ip";
  const claimResult = await redisCommand([
    "SET",
    slotKey,
    ip,
    "EX",
    String(SLOT_TTL_SECONDS),
    "NX"
  ]);

  if (claimResult === "OK") {
    return { allowed: true };
  }

  const acceptedIp = await redisCommand(["GET", slotKey]);
  if (acceptedIp && acceptedIp !== ip) {
    return { allowed: false, message: "Addon temporarily unavailable" };
  }

  return { allowed: true };
}

module.exports = async function (req, res) {
  try {
    const controlResult = await applyRequestControls(req);
    if (!controlResult.allowed) {
      sendBlocked(res, controlResult.message);
      return;
    }
  } catch {
    sendBlocked(res, "Addon temporarily unavailable");
    return;
  }

  router(req, res, function () {
    res.statusCode = 404;
    res.end();
  });
};
