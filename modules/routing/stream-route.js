const { createDClient } = require("../integrations/d-client");
const defaultStreamPayloads = require("../presentation/stream-payloads");
const { getLogger } = require("../../observability/logger");
const { createConcurrencyGuard } = require("../integrations/concurrency-guard");
const { defaultCache } = require("../integrations/cache");
const { EVENTS, emitEvent, classifyFailure: classifyFailureUtil } = require("../../observability/events");
const { incrementReliabilityCounter } = require("../../observability/metrics");

const logger = getLogger({ component: "stream-route" });

// Module-level default — per-Vercel-invocation scope (state resets each cold start).
// Override via injected.concurrencyGuard in tests or future A/B configuration.
const defaultGuard = createConcurrencyGuard({
  providerConcurrencyLimit: Number(process.env.PROVIDER_CONCURRENCY_LIMIT) || 3,
  globalConcurrencyLimit: Number(process.env.GLOBAL_CONCURRENCY_LIMIT) || 10
});

const STREAM_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=14400, stale-if-error=604800";

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

function normalizeStreamUrl(rawUrl) {
  const base = typeof rawUrl === "string" ? rawUrl.replace(/^http:\/\//, "https://") : "";
  try {
    const u = new URL(base);
    u.searchParams.delete("range");
    return u.toString();
  } catch {
    return base;
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
  const sendDegradedStream = injected.sendDegradedStream || streamPayloads.sendDegradedStream;

  const requestUserAgent = String(req && req.headers && req.headers["user-agent"] || "");
  const streamInjected = {
    ...injected,
    requestUserAgent,
    requestRoute: pathname,
    requestStartedAt: Date.now(),
    correlationId: req && req.headers && (req.headers["x-correlation-id"] || req.headers["X-Correlation-Id"]) || ""
  };

  const guard = injected.concurrencyGuard || defaultGuard;
  const streamCache = injected.streamCache || defaultCache;
  const cached = streamCache.get(episodeId);

  if (cached.hit && cached.negative) {
    sendDegradedStream(req, res, "dependency_unavailable", injected);
    return { handled: true, outcome: { source: "cache", cause: "cache_negative", result: "degraded" } };
  }

  if (cached.hit) {
    const formatStreamLocal = injected.formatStream || streamPayloads.formatStream;
    if (res && typeof res.setHeader === "function") {
      res.setHeader("Cache-Control", STREAM_CACHE_CONTROL);
    }
    injected.sendJson(req, res, 200, {
      streams: [formatStreamLocal(cached.value.title, cached.value.finalUrl, { filename: cached.value.title })]
    });

    if (cached.stale) {
      const resolveForSwr = resolveEpisodeResolver(streamInjected);
      Promise.resolve()
        .then(() => resolveForSwr(episodeId))
        .then((refreshed) => {
          const refreshFinalUrl = normalizeStreamUrl(refreshed.url);
          if (refreshFinalUrl.startsWith("https://")) {
            streamCache.set(episodeId, { title: refreshed.title, finalUrl: refreshFinalUrl });
          }
        })
        .catch(() => { /* keep stale, no eviction */ });
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
        }
      }))
      .catch(() => {});

    return { handled: true, outcome: { source: "cache", cause: cached.stale ? "cache_stale" : "cache_hit", result: "success" } };
  }

  try {
    if (typeof injected.sendJson !== "function") {
      throw new Error("handleStreamRequest requires injected.sendJson");
    }

    const resolveEpisode = resolveEpisodeResolver(streamInjected);
    const resolved = await guard.execute(episodeId, () => resolveEpisode(episodeId));
    const finalUrl = normalizeStreamUrl(resolved.url);

    if (!finalUrl.startsWith("https://")) {
      const validationLabels = { source: 'validation', cause: 'validation_invalid_stream_url', routeClass: 'stremio', result: 'degraded' };
      emitEvent(logger, EVENTS.DEPENDENCY_FAILURE, { ...validationLabels, episodeId, detail: 'Resolved URL was empty or non-HTTPS' });
      await incrementReliabilityCounter(null, validationLabels);
      streamCache.setNegative(episodeId);
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

    streamCache.set(episodeId, { title: resolved.title, finalUrl });
    if (res && typeof res.setHeader === "function") {
      res.setHeader("Cache-Control", STREAM_CACHE_CONTROL);
    }

    const formatStreamLocal = injected.formatStream || streamPayloads.formatStream;
    injected.sendJson(req, res, 200, {
      streams: [formatStreamLocal(resolved.title, finalUrl, { filename: resolved.title })]
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
    const classifyFailureFn = injected.classifyFailure || classifyFailureUtil;
    const degraded = classifyFailureFn({ error, source: "d" });
    const catchLabels = { source: degraded.source, cause: degraded.cause, routeClass: 'stremio', result: 'degraded' };
    emitEvent(logger, EVENTS.DEPENDENCY_FAILURE, { ...catchLabels, episodeId });
    await incrementReliabilityCounter(null, catchLabels);
    streamCache.setNegative(episodeId);
    sendDegradedStream(req, res, error, injected);
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

module.exports = {
  handleStreamRequest
};
