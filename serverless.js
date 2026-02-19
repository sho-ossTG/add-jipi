const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");

const router = getRouter(addonInterface);

// Constants
const SLOT_TTL = 3600; 
const INACTIVITY_LIMIT = 20 * 60; 
const ACTIVE_URL_TTL = 3600 * 2; 
const TEST_VIDEO_URL = "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_1MB.mp4";

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const NEUTRAL_ORIGIN = "https://www.google.com/";

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

function formatStream(title, url) {
  return {
    title: title,
    url: url,
    behaviorHints: {
      notWebReady: false,
      proxyHeaders: {
        request: {
          "User-Agent": BROWSER_UA,
          "Referer": NEUTRAL_ORIGIN,
          "Origin": NEUTRAL_ORIGIN
        }
      }
    }
  };
}

function sendErrorStream(res, title) {
  sendJson(res, 200, {
    streams: [formatStream(`⚠️ ${title}`, TEST_VIDEO_URL)]
  });
}

function getLandingPageHtml() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>One Piece (Jipi) - Stremio Addon</title>
    <style>
        body { margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), url('https://dl.strem.io/addon-background.jpg') no-repeat center center fixed; background-size: cover; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; text-align: center; }
        .container { background: rgba(0, 0, 0, 0.8); padding: 3rem; border-radius: 15px; max-width: 500px; width: 90%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); }
        h1 { margin-top: 0; margin-bottom: 1rem; font-size: 2.5rem; }
        p { margin-bottom: 2.5rem; opacity: 0.9; font-size: 1.1rem; line-height: 1.6; }
        .install-btn { display: inline-block; background-color: #8A5BB8; color: white; padding: 1.2rem 2.5rem; text-decoration: none; font-weight: bold; border-radius: 8px; margin-bottom: 1.5rem; transition: transform 0.2s, background 0.3s; font-size: 1.2rem; letter-spacing: 1px; }
        .install-btn:hover { background-color: #7a4ba8; transform: scale(1.05); }
        .manifest-link { display: block; color: #aaa; text-decoration: none; font-size: 0.9rem; transition: color 0.3s; }
        .manifest-link:hover { color: #fff; text-decoration: underline; }
        .nav-links { margin-top: 2rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1rem; }
        .nav-links a { color: #8A5BB8; text-decoration: none; margin: 0 10px; font-size: 0.8rem; }
    </style>
    <script>
        window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    </script>
    <script defer src="/_vercel/insights/script.js"></script>
</head>
<body>
    <div class="container">
        <h1>One Piece (Jipi)</h1>
        <p>Streams resolved via Broker (B) and Worker (C)</p>
        <a href="stremio://add-jipi.vercel.app/manifest.json" class="install-btn">INSTALL ADDON</a>
        <a href="https://add-jipi.vercel.app/manifest.json" class="manifest-link">Manual Manifest Link</a>
        <div class="nav-links">
            <a href="/health">Health Check</a>
            <a href="/quarantine">Quarantine Logs</a>
        </div>
    </div>
    <script>
      window.si = window.si || function(){(window.si.q=window.si.q||[]).push(arguments)};
    </script>
    <script defer src="/_vercel/speed-insights/script.js"></script>
</body>
</html>
  `.trim();
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
      await redisCommand(["INCR", "stats:slot_taken"]);
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
          streams: [formatStream(existing.title || "Resolved via Jipi", existing.url)]
        });
        return true;
      }
    } catch (e) { }
  }

  // Resolve via B
  try {
    const resolved = await addonInterface.resolveEpisode(episodeId);
    let finalUrl = resolved.url || "";
    
    // Enforce HTTPS
    if (finalUrl.startsWith("http://")) {
      finalUrl = finalUrl.replace("http://", "https://");
    }

    if (!finalUrl.startsWith("https://")) {
      sendErrorStream(res, "ERROR: Resolved URL is not HTTPS (Incompatible with Desktop/TV).");
      return true;
    }

    const payload = {
      url: finalUrl,
      episodeId,
      title: resolved.title,
      updatedAt: Date.now()
    };
    
    await redisCommand(["SET", activeUrlKey, JSON.stringify(payload), "EX", String(ACTIVE_URL_TTL)]);
    await redisCommand(["SET", lastSeenKey, String(Date.now()), "EX", String(INACTIVITY_LIMIT)]);

    sendJson(res, 200, {
      streams: [formatStream(resolved.title || "Resolved via Jipi", finalUrl)]
    });
    return true;
  } catch (err) {
    await redisCommand(["INCR", "stats:broker_error"]);
    const event = {
      ip,
      error: err.message,
      episodeId,
      time: new Date().toISOString()
    };
    try {
      await redisCommand(["LPUSH", "quarantine:events", JSON.stringify(event)]);
      await redisCommand(["LTRIM", "quarantine:events", "0", "49"]);
    } catch (redisErr) { }
    
    sendErrorStream(res, "ERROR: Broker timeout or invalid response.");
    return true;
  }
}

async function handleQuarantine(res) {
  const eventsRaw = await redisCommand(["LRANGE", "quarantine:events", "0", "-1"]);
  const slotTaken = await redisCommand(["GET", "stats:slot_taken"]) || 0;
  const brokerErrors = await redisCommand(["GET", "stats:broker_error"]) || 0;

  const events = eventsRaw.map(e => {
    try { return JSON.parse(e); } catch { return { error: "Parse error", raw: e }; }
  });

  const rows = events.map(e => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #444">${e.time || ""}</td>
      <td style="padding:8px;border-bottom:1px solid #444">${e.ip || ""}</td>
      <td style="padding:8px;border-bottom:1px solid #444">${e.episodeId || ""}</td>
      <td style="padding:8px;border-bottom:1px solid #444;color:#ff6b6b">${e.error || ""}</td>
    </tr>
  `).join("");

  const html = `
    <html>
      <body style="background:#1a1a1a;color:#eee;font-family:sans-serif;padding:2rem">
        <h2>Quarantine Events (Last 50)</h2>
        <p><b>Stats:</b> Slot Taken Blocks: ${slotTaken} | Broker Errors: ${brokerErrors}</p>
        <table style="width:100%;border-collapse:collapse;background:#2a2a2a">
          <thead>
            <tr style="background:#333">
              <th style="padding:8px;text-align:left">Time</th>
              <th style="padding:8px;text-align:left">IP</th>
              <th style="padding:8px;text-align:left">Episode</th>
              <th style="padding:8px;text-align:left">Error</th>
            </tr>
          </thead>
          <tbody>${rows || "<tr><td colspan='4' style='padding:20px;text-align:center'>No events</td></tr>"}</tbody>
        </table>
        <br><a href="/" style="color:#8A5BB8">Back to Home</a>
      </body>
    </html>
  `;
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html");
  res.end(html);
}

module.exports = async function (req, res) {
  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = reqUrl.pathname;

  if (pathname === "/") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html");
    res.end(getLandingPageHtml());
    return;
  }

  if (pathname === "/health") {
    try {
      await redisCommand(["PING"]);
      sendJson(res, 200, { status: "OK", redis: "Connected" });
    } catch (e) {
      sendJson(res, 500, { status: "FAIL", error: e.message });
    }
    return;
  }

  if (pathname === "/quarantine") {
    try {
      await handleQuarantine(res);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  try {
    const controlResult = await applyRequestControls(req, pathname);
    
    if (!controlResult.allowed) {
      if (pathname.startsWith("/stream/")) {
        const errorMsg = controlResult.reason === "blocked:shutdown_window" 
          ? "ERROR: Blocked between 20:00–21:00 (Jerusalem time)."
          : "ERROR: System busy (slot taken). Try again later.";
        sendErrorStream(res, errorMsg);
        return;
      }
      sendJson(res, 503, { error: "Addon temporarily unavailable", reason: controlResult.reason });
      return;
    }

    if (pathname.startsWith("/stream/")) {
      const handled = await handleStreamRequest(res, pathname, controlResult.ip || getClientIp(req));
      if (handled) return;
    }
  } catch (error) {
    if (pathname.startsWith("/stream/")) {
      sendErrorStream(res, "ERROR: System/Database error. Try again.");
      return;
    }
    sendJson(res, 503, { error: "Addon error", message: error.message });
    return;
  }

  router(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
};
