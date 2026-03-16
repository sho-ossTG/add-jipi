const { createDClient } = require("../integrations/d-client");
const defaultStreamPayloads = require("../presentation/stream-payloads");
const {
  acquireInFlightLock,
  createDegradedMarker,
  createStaleMarker,
  createSuccessMarker,
  releaseInFlightLock,
  waitForInFlightResult,
  writeInFlightResult
} = require("./stream-dedup");
const { getLogger } = require("../../observability/logger");

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
    const tracker = typeof injected.trackSessionView === "function" ? injected.trackSessionView : null;
    if (!tracker) {
      return;
    }
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

  const dedupLock = await acquireInFlightLock({
    redisCommand,
    episodeId,
    ip,
    lockTtlSec: Number(injected.dedupLockTtlSec || 70),
    nowMs: Date.now()
  });

  if (!dedupLock.acquired) {
    const marker = await waitForInFlightResult({
      redisCommand,
      episodeId,
      ip,
      waitTimeoutMs: Number(injected.dedupWaitTimeoutMs || 70000),
      pollIntervalMs: Number(injected.dedupPollIntervalMs || 500),
      now: typeof injected.now === "function" ? injected.now : () => Date.now(),
      sleep: typeof injected.sleep === "function" ? injected.sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    });

    if (marker && marker.type === "success") {
      await writeSessionView({
        resolvedUrl: marker.url,
        title: marker.title,
        status: "cache_hit",
        reason: "dedup_wait_hit"
      });
      return {
        status: "ok",
        title: marker.title,
        url: marker.url
      };
    }

    if (marker && marker.type === "stale") {
      return {
        status: "stale"
      };
    }

    return {
      status: "degraded",
      cause: marker && marker.type === "degraded"
        ? marker.cause
        : "dependency_timeout"
    };
  }

  try {
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
      resolved = await resolveEpisode(episodeId, { clientIp: ip });
    } catch (error) {
      const classifyFailure = typeof injected.classifyFailure === "function"
        ? injected.classifyFailure
        : () => ({ source: "d", cause: "dependency_unavailable" });
      const failure = classifyFailure({ error, source: "d" });
      await writeInFlightResult({
        redisCommand,
        episodeId,
        ip,
        marker: createDegradedMarker({ cause: failure.cause || "dependency_unavailable" }),
        resultTtlSec: Number(injected.dedupResultTtlSec || 70)
      });
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
      await writeInFlightResult({
        redisCommand,
        episodeId,
        ip,
        marker: createDegradedMarker({ cause: "validation_invalid_stream_url" }),
        resultTtlSec: Number(injected.dedupResultTtlSec || 70)
      });
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
      await writeInFlightResult({
        redisCommand,
        episodeId,
        ip,
        marker: createStaleMarker(),
        resultTtlSec: Number(injected.dedupResultTtlSec || 70)
      });
      return {
        status: "stale"
      };
    }

    await redisCommand(["SET", shareKey, JSON.stringify(payload), "EX", String(EPISODE_SHARE_TTL_SEC)]);
    await writeInFlightResult({
      redisCommand,
      episodeId,
      ip,
      marker: createSuccessMarker({
        title: resolved.title,
        url: finalUrl
      }),
      resultTtlSec: Number(injected.dedupResultTtlSec || 70)
    });
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
  } finally {
    await releaseInFlightLock({
      redisCommand,
      episodeId,
      ip
    });
  }
}

async function resolveLatestStreamIntent(ip, episodeId, injected = {}) {
  let currentEpisodeId = episodeId;

  while (true) {
    const result = await resolveStreamIntent(ip, currentEpisodeId, injected);
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

  if (injected.disableUpstashRecords) {
    try {
      if (typeof injected.sendJson !== "function") {
        throw new Error("handleStreamRequest requires injected.sendJson");
      }

      const resolveEpisode = resolveEpisodeResolver(streamInjected);
      const resolved = await resolveEpisode(episodeId);
      const finalUrl = typeof resolved.url === "string"
        ? resolved.url.replace(/^http:\/\//, "https://")
        : "";

      if (!finalUrl.startsWith("https://")) {
        sendDegradedStream(req, res, "validation_invalid_stream_url", injected);
        return {
          handled: true,
          outcome: {
            source: "validation",
            cause: "validation_invalid_stream_url",
            result: "degraded"
          }
        };
      }

      const formatStreamLocal = injected.formatStream || streamPayloads.formatStream;
      injected.sendJson(req, res, 200, {
        streams: [formatStreamLocal(resolved.title, finalUrl)]
      });

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
          }
        }))
        .catch(() => {});

      return {
        handled: true,
        outcome: {
          source: "d",
          cause: "success",
          result: "success"
        }
      };
    } catch (error) {
      sendDegradedStream(req, res, error, injected);
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
    }
  }

  markLatestSelection(ip, episodeId);

  try {
    const result = await resolveLatestStreamIntent(ip, episodeId, streamInjected);

    if (result.status === "degraded") {
      const classifyFailure = injected.classifyFailure || ((value) => ({ source: "d", cause: value.reason || "dependency_unavailable" }));
      const degraded = classifyFailure({ reason: result.cause || "dependency_unavailable", source: "d" });
      if (typeof injected.trackSessionView === "function") {
        try {
          await injected.trackSessionView(injected.redisCommand, {
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
        clientIp: ip,
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

    if (typeof injected.trackSessionView === "function") {
      try {
        await injected.trackSessionView(injected.redisCommand, {
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
