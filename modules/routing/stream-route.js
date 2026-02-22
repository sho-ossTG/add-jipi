const defaultStreamPayloads = require("../presentation/stream-payloads");

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

  if (typeof injected.markLatestSelection === "function") {
    injected.markLatestSelection(ip, episodeId);
  }

  try {
    const resolveLatestStreamIntent = injected.resolveLatestStreamIntent;
    if (typeof resolveLatestStreamIntent !== "function") {
      throw new Error("handleStreamRequest requires injected.resolveLatestStreamIntent");
    }

    const result = await resolveLatestStreamIntent(ip, episodeId);
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
    if (typeof injected.pruneLatestSelections === "function") {
      injected.pruneLatestSelections();
    }
  }
}

module.exports = {
  handleStreamRequest
};
