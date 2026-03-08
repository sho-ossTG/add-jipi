const { createDClient } = require("../integrations/d-client");
const defaultStreamPayloads = require("../presentation/stream-payloads");
const { upsertSessionView } = require("../analytics/session-view");
const { getLogger } = require("../../observability/logger");

const inFlightStreamIntents = new Map();
const latestStreamSelectionByClient = new Map();
let latestStreamSelectionVersion = 0;

const LATEST_SELECTION_TTL_MS = 5 * 60 * 1000;
const INACTIVITY_LIMIT = 20 * 60;
const EPISODE_SHARE_TTL_SEC = 30 * 60;
const EPISODE_SHARE_MAX_IPS = 6;
const EPISODE_SHARE_KEY_PREFIX = "episode:share";
const logger = getLogger({ component: "stream-route" });

function buildEpisodeShareKey(episodeId) {
  return `${EPISODE_SHARE_KEY_PREFIX}:${episodeId}`;
}

function parseEpisodeShare(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeAllowedIps(raw = []) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const output = [];
  for (const entry of raw) {
    const ip = String(entry || "").trim();
    if (!ip || seen.has(ip)) continue;
    seen.add(ip);
    output.push(ip);
  }
  return output.slice(0, EPISODE_SHARE_MAX_IPS);
}

function remainingShareTtlSec(state = {}, nowMs) {
  const createdAtMs = Number(state.createdAtMs || 0);
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) {
    return EPISODE_SHARE_TTL_SEC;
  }
  const expiresAtMs = createdAtMs + (EPISODE_SHARE_TTL_SEC * 1000);
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
}

function getLatestSelection(clientId) {
  const latest = latestStreamSelectionByClient.get(clientId);
  if (!latest) return null;

  if ((Date.now() - latest.updatedAt) > LATEST_SELECTION_TTL_MS) {
    latestStreamSelectionByClient.delete(clientId);
    return null;
  }

  return latest;
}

function pruneLatestSelections(now = Date.now()) {
  for (const [clientId, selection] of latestStreamSelectionByClient.entries()) {
    if ((now - selection.updatedAt) > LATEST_SELECTION_TTL_MS) {
      latestStreamSelectionByClient.delete(clientId);
    }
  }
}

function isCurrentEpisodeSelection(clientId, episodeId) {
  const latest = getLatestSelection(clientId);
  if (!latest) return true;
  return latest.episodeId === episodeId;
}

function markLatestSelection(clientId, episodeId) {
  pruneLatestSelections();
  latestStreamSelectionVersion += 1;
  const next = {
    episodeId,
    version: latestStreamSelectionVersion,
    updatedAt: Date.now()
  };
  latestStreamSelectionByClient.set(clientId, next);
  return next;
}

function getOrCreateInFlightIntent(intentKey, producer) {
  if (inFlightStreamIntents.has(intentKey)) {
    return inFlightStreamIntents.get(intentKey);
  }

  const inFlight = Promise.resolve()
    .then(() => producer())
    .finally(() => {
      inFlightStreamIntents.delete(intentKey);
    });

  inFlightStreamIntents.set(intentKey, inFlight);
  return inFlight;
}

function resolveEpisodeResolver(injected = {}) {
  if (typeof injected.resolveEpisode === "function") {
    return injected.resolveEpisode;
  }

  const dClient = createDClient({
    baseUrl: injected.dBaseUrl,
    fetchImpl: injected.fetchImpl,
    executeBoundedDependency: injected.executeBoundedDependency
  });
  return dClient.resolveEpisode.bind(dClient);
}

function resolveForwardUserAgent(injected = {}) {
  if (typeof injected.forwardUserAgent === "function") {
    return injected.forwardUserAgent;
  }

  const dClient = createDClient({
    baseUrl: injected.dBaseUrl,
    fetchImpl: injected.fetchImpl,
    executeBoundedDependency: injected.executeBoundedDependency
  });
  return dClient.forwardUserAgent.bind(dClient);
}

async function resolveStreamIntent(ip, episodeId, injected = {}) {
  if (typeof injected.redisCommand !== "function") {
    throw new Error("handleStreamRequest requires injected.redisCommand");
  }

  const shareKey = buildEpisodeShareKey(episodeId);
  const redisCommand = injected.redisCommand;

  async function writeSessionView(state = {}) {
    const tracker = typeof injected.trackSessionView === "function" ? injected.trackSessionView : upsertSessionView;
    const ttlSec = Number(injected.sessionViewTtlSec || injected.inactivityLimitSec || INACTIVITY_LIMIT);
    await tracker(redisCommand, {
      ip,
      userAgent: injected.requestUserAgent,
      route: injected.requestRoute,
      episodeId,
      resolvedUrl: state.resolvedUrl,
      title: state.title,
      status: state.status,
      reason: state.reason,
      startedAt: injected.requestStartedAt,
      correlationId: injected.correlationId
    }, {
      ttlSec
    });
  }

  const existingShareRaw = await redisCommand(["GET", shareKey]);
  const existingShare = parseEpisodeShare(existingShareRaw);
  if (existingShare && existingShare.episodeId === episodeId && String(existingShare.url || "").startsWith("https://")) {
    const allowedIps = normalizeAllowedIps(existingShare.allowedIps);
    if (allowedIps.includes(ip)) {
      await writeSessionView({
        resolvedUrl: existingShare.url,
        title: existingShare.title,
        status: "cache_hit",
        reason: "episode_share_hit"
      });
      return {
        status: "ok",
        title: existingShare.title,
        url: existingShare.url
      };
    }

    if (allowedIps.length >= EPISODE_SHARE_MAX_IPS) {
      return {
        status: "degraded",
        cause: "blocked:capacity_busy"
      };
    }

    const nowMs = Date.now();
    const ttlSec = remainingShareTtlSec(existingShare, nowMs);
    if (ttlSec > 0) {
      const nextShare = {
        ...existingShare,
        allowedIps: [...allowedIps, ip],
        lastSharedAtMs: nowMs
      };
      await redisCommand(["SET", shareKey, JSON.stringify(nextShare), "EX", String(ttlSec)]);
      await writeSessionView({
        resolvedUrl: nextShare.url,
        title: nextShare.title,
        status: "cache_hit",
        reason: "episode_share_join"
      });
      return {
        status: "ok",
        title: nextShare.title,
        url: nextShare.url
      };
    }
  }

  if (typeof injected.emitTelemetry === "function") {
    injected.emitTelemetry(injected.events && injected.events.DEPENDENCY_ATTEMPT, {
      source: "d",
      cause: "resolve_episode",
      dependency: "d",
      episodeId
    });
  }

  const resolveEpisode = resolveEpisodeResolver(injected);
  let resolved;
  try {
    resolved = await resolveEpisode(episodeId);
  } catch (error) {
    if (typeof injected.emitTelemetry === "function" && typeof injected.classifyFailure === "function") {
      const errorDetail = String((error && error.message) || error || "unknown error");
      injected.emitTelemetry(injected.events && injected.events.DEPENDENCY_FAILURE, {
        ...injected.classifyFailure({ error, source: "d" }),
        dependency: "d",
        episodeId,
        message: `Server A could not resolve stream metadata for episode ${episodeId} because Server D returned an error: ${errorDetail}`
      });
    }
    throw error;
  }

  let finalUrl = resolved.url || "";
  if (finalUrl.startsWith("http://")) {
    finalUrl = finalUrl.replace("http://", "https://");
  }

  if (!finalUrl.startsWith("https://")) {
    if (typeof injected.emitTelemetry === "function") {
      injected.emitTelemetry(injected.events && injected.events.DEPENDENCY_FAILURE, {
        source: "validation",
        cause: "validation_invalid_stream_url",
        dependency: "d",
        episodeId,
        message: `Server A rejected the resolved stream URL for episode ${episodeId} because Server D returned a non-HTTPS URL: ${String(finalUrl || "empty")}`
      });
    }
    return {
      status: "degraded",
      cause: "validation_invalid_stream_url"
    };
  }

  const nowMs = Date.now();
  const payload = {
    episodeId,
    url: finalUrl,
    title: resolved.title,
    ownerIp: ip,
    allowedIps: [ip],
    createdAtMs: nowMs,
    lastSharedAtMs: nowMs
  };

  if (!isCurrentEpisodeSelection(ip, episodeId)) {
    return {
      status: "stale"
    };
  }

  await redisCommand(["SET", shareKey, JSON.stringify(payload), "EX", String(EPISODE_SHARE_TTL_SEC)]);
  await writeSessionView({
    resolvedUrl: finalUrl,
    title: resolved.title,
    status: "resolved",
    reason: "resolved_success"
  });

  return {
    status: "ok",
    title: resolved.title,
    url: finalUrl
  };
}

async function resolveLatestStreamIntent(ip, episodeId, injected = {}) {
  let currentEpisodeId = episodeId;

  while (true) {
    const intentKey = `${ip}:${currentEpisodeId}`;
    const result = await getOrCreateInFlightIntent(intentKey, () => resolveStreamIntent(ip, currentEpisodeId, injected));
    const latest = getLatestSelection(ip);

    if (result.status === "stale" && latest && latest.episodeId !== currentEpisodeId) {
      currentEpisodeId = latest.episodeId;
      continue;
    }

    if (!latest || latest.episodeId === currentEpisodeId) {
      return result;
    }

    currentEpisodeId = latest.episodeId;
  }
}

async function handleStreamRequest(input = {}, injected = {}) {
  const req = input.req;
  const res = input.res;
  const pathname = String(input.pathname || "");
  const ip = String(input.ip || "");

  const match = pathname.match(/^\/stream\/([^/]+)\/([^/]+)\.json$/);
  if (!match || match[1] !== "series") {
    return { handled: false };
  }

  const episodeId = decodeURIComponent(match[2]);
  const isSupportedEpisode = injected.isSupportedEpisode || ((id) => id.startsWith("tt0388629"));
  if (!isSupportedEpisode(episodeId)) {
    return { handled: false };
  }

  const streamPayloads = injected.streamPayloads || defaultStreamPayloads;
  const formatStream = injected.formatStream || streamPayloads.formatStream;
  const sendDegradedStream = injected.sendDegradedStream || streamPayloads.sendDegradedStream;

  async function trackStreamEvent(fields = []) {
    if (typeof injected.trackHourlyEvent !== "function") {
      return;
    }

    try {
      await injected.trackHourlyEvent(injected.redisCommand, {
        fields,
        uniqueId: ip,
        ttlSec: injected.hourlyAnalyticsTtlSec
      }, {
        ttlSec: injected.hourlyAnalyticsTtlSec
      });
    } catch {
      // Hourly analytics are best-effort and must not affect requests.
    }
  }

  const requestUserAgent = String(req && req.headers && req.headers["user-agent"] || "");
  const streamInjected = {
    ...injected,
    requestUserAgent,
    requestRoute: pathname,
    requestStartedAt: Date.now(),
    correlationId: req && req.headers && (req.headers["x-correlation-id"] || req.headers["X-Correlation-Id"]) || ""
  };

  markLatestSelection(ip, episodeId);

  try {
    const result = await resolveLatestStreamIntent(ip, episodeId, streamInjected);

    if (result.status === "degraded") {
      const classifyFailure = injected.classifyFailure || ((value) => ({ source: "d", cause: value.reason || "dependency_unavailable" }));
      const degraded = classifyFailure({ reason: result.cause || "dependency_unavailable", source: "d" });
      try {
        await upsertSessionView(injected.redisCommand, {
          ip,
          userAgent: requestUserAgent,
          route: pathname,
          episodeId,
          status: "degraded",
          reason: result.cause || "dependency_unavailable",
          startedAt: streamInjected.requestStartedAt,
          correlationId: streamInjected.correlationId
        }, {
          ttlSec: Number(injected.sessionViewTtlSec || injected.inactivityLimitSec || INACTIVITY_LIMIT)
        });
      } catch {
        // Best-effort session snapshot path.
      }

      sendDegradedStream(req, res, result.cause, injected);
      await trackStreamEvent([
        "stream.requests",
        "stream.degraded",
        `stream.degraded:${String(result.cause || "dependency_unavailable")}`
      ]);
      return {
        handled: true,
        outcome: {
          source: degraded.source,
          cause: degraded.cause,
          result: "degraded"
        }
      };
    }

    if (typeof injected.sendJson !== "function") {
      throw new Error("handleStreamRequest requires injected.sendJson");
    }

    const forwardUserAgent = resolveForwardUserAgent(streamInjected);
    Promise.resolve()
      .then(() => forwardUserAgent(requestUserAgent, episodeId, {
        onFailure: (error) => {
          logger.warn({
            episodeId,
            userAgent: requestUserAgent,
            errorCode: String(error && error.code || "ua_forward_error"),
            errorMessage: String(error && error.message || "Unknown UA forward error")
          }, "ua_forward_failed");

          if (typeof injected.onUaForwardError === "function") {
            Promise.resolve()
              .then(() => injected.onUaForwardError({
                error,
                episodeId,
                ip,
                userAgent: requestUserAgent
              }))
              .catch(() => {});
          }
        }
      }))
      .catch((error) => {
        logger.warn({
          episodeId,
          userAgent: requestUserAgent,
          errorCode: String(error && error.code || "ua_forward_error"),
          errorMessage: String(error && error.message || "Unknown UA forward error")
        }, "ua_forward_failed");
      });

    injected.sendJson(req, res, 200, {
      streams: [formatStream(result.title, result.url)]
    });
    await trackStreamEvent([
      "stream.requests",
      "stream.success"
    ]);
    return {
      handled: true,
      outcome: {
        source: "d",
        cause: "success",
        result: "success"
      }
    };
  } catch (error) {
    if (typeof injected.onStreamError === "function") {
      await injected.onStreamError({ error, ip, episodeId });
    }

    try {
      await upsertSessionView(injected.redisCommand, {
        ip,
        userAgent: requestUserAgent,
        route: pathname,
        episodeId,
        status: "error",
        reason: String(error && error.code || "stream_error"),
        startedAt: streamInjected.requestStartedAt,
        correlationId: streamInjected.correlationId
      }, {
        ttlSec: Number(injected.sessionViewTtlSec || injected.inactivityLimitSec || INACTIVITY_LIMIT)
      });
    } catch {
      // Best-effort session snapshot path.
    }

    sendDegradedStream(req, res, error, injected);
    await trackStreamEvent([
      "stream.requests",
      "stream.degraded",
      `stream.error:${String(error && error.code || "stream_error")}`
    ]);
    const classifyFailure = injected.classifyFailure || ((value) => ({ source: "d", cause: value.error ? "dependency_unavailable" : "dependency_unavailable" }));
    const degraded = classifyFailure({ error, source: "d" });
    return {
      handled: true,
      outcome: {
        source: degraded.source,
        cause: degraded.cause,
        result: "degraded"
      }
    };
  } finally {
    pruneLatestSelections();
  }
}

module.exports = {
  handleStreamRequest
};
