const { createBrokerClient } = require("../integrations/broker-client");
const defaultStreamPayloads = require("../presentation/stream-payloads");

const inFlightStreamIntents = new Map();
const latestStreamSelectionByClient = new Map();
let latestStreamSelectionVersion = 0;

const LATEST_SELECTION_TTL_MS = 5 * 60 * 1000;
const ACTIVE_URL_TTL = 3600 * 2;
const INACTIVITY_LIMIT = 20 * 60;

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

  if (injected.brokerClient && typeof injected.brokerClient.resolveEpisode === "function") {
    return injected.brokerClient.resolveEpisode.bind(injected.brokerClient);
  }

  const brokerClient = createBrokerClient({
    baseUrl: injected.brokerBaseUrl,
    fetchImpl: injected.fetchImpl,
    executeBoundedDependency: injected.executeBoundedDependency
  });
  return brokerClient.resolveEpisode.bind(brokerClient);
}

async function resolveStreamIntent(ip, episodeId, injected = {}) {
  if (typeof injected.redisCommand !== "function") {
    throw new Error("handleStreamRequest requires injected.redisCommand");
  }

  const activeUrlKey = `active:url:${ip}`;
  const lastSeenKey = `active:last_seen:${ip}`;
  const redisCommand = injected.redisCommand;

  const existingRaw = await redisCommand(["GET", activeUrlKey]);
  if (existingRaw) {
    try {
      const existing = JSON.parse(existingRaw);
      if (existing.episodeId === episodeId) {
        await redisCommand(["SET", lastSeenKey, String(Date.now()), "EX", String(INACTIVITY_LIMIT)]);
        return {
          status: "ok",
          title: existing.title || "Resolved via Jipi",
          url: existing.url
        };
      }
    } catch {
      // Ignore malformed cache payload and re-resolve.
    }
  }

  if (typeof injected.emitTelemetry === "function") {
    injected.emitTelemetry(injected.events && injected.events.DEPENDENCY_ATTEMPT, {
      source: "broker",
      cause: "resolve_episode",
      dependency: "broker",
      episodeId
    });
  }

  const resolveEpisode = resolveEpisodeResolver(injected);
  let resolved;
  try {
    resolved = await resolveEpisode(episodeId);
  } catch (error) {
    if (typeof injected.emitTelemetry === "function" && typeof injected.classifyFailure === "function") {
      injected.emitTelemetry(injected.events && injected.events.DEPENDENCY_FAILURE, {
        ...injected.classifyFailure({ error, source: "broker" }),
        dependency: "broker",
        episodeId
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
        dependency: "broker",
        episodeId
      });
    }
    return {
      status: "degraded",
      cause: "validation_invalid_stream_url"
    };
  }

  const payload = {
    url: finalUrl,
    episodeId,
    title: resolved.title,
    updatedAt: Date.now()
  };

  if (!isCurrentEpisodeSelection(ip, episodeId)) {
    return {
      status: "stale"
    };
  }

  await redisCommand(["SET", activeUrlKey, JSON.stringify(payload), "EX", String(ACTIVE_URL_TTL)]);
  await redisCommand(["SET", lastSeenKey, String(Date.now()), "EX", String(INACTIVITY_LIMIT)]);

  return {
    status: "ok",
    title: resolved.title || "Resolved via Jipi",
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

  markLatestSelection(ip, episodeId);

  try {
    const result = await resolveLatestStreamIntent(ip, episodeId, injected);

    if (result.status === "degraded") {
      const classifyFailure = injected.classifyFailure || ((value) => ({ source: "broker", cause: value.reason || "dependency_unavailable" }));
      const degraded = classifyFailure({ reason: result.cause || "dependency_unavailable", source: "broker" });
      sendDegradedStream(req, res, result.cause, injected);
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

    injected.sendJson(req, res, 200, {
      streams: [formatStream(result.title, result.url)]
    });
    return {
      handled: true,
      outcome: {
        source: "broker",
        cause: "success",
        result: "success"
      }
    };
  } catch (error) {
    if (typeof injected.onStreamError === "function") {
      await injected.onStreamError({ error, ip, episodeId });
    }

    sendDegradedStream(req, res, error, injected);
    const classifyFailure = injected.classifyFailure || ((value) => ({ source: "broker", cause: value.error ? "dependency_unavailable" : "dependency_unavailable" }));
    const degraded = classifyFailure({ error, source: "broker" });
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
