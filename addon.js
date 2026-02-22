const { addonBuilder } = require("stremio-addon-sdk");

const B_BASE_URL = process.env.B_BASE_URL || "";
const IMDB_ID = "tt0388629";
const DEPENDENCY_ATTEMPT_TIMEOUT_MS = 900;
const DEPENDENCY_TOTAL_TIMEOUT_MS = 1800;
const DEPENDENCY_RETRY_JITTER_MS = 120;

const manifest = {
  id: "org.jipi.onepiece",
  version: "1.0.0",
  name: "One Piece (Jipi)",
  description: "Streams resolved via Broker (B) and Worker (C)",
  resources: ["catalog", "stream"],
  types: ["series"],
  catalogs: [{ type: "series", id: "onepiece_catalog", name: "One Piece" }],
  idPrefixes: [IMDB_ID]
};

const builder = new addonBuilder(manifest);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomJitter(maxMs) {
  return Math.floor(Math.random() * Math.max(1, maxMs));
}

function isTransientDependencyFailure(error) {
  if (!error) return false;
  const status = Number(error.statusCode || 0);
  if (status === 408 || status === 429 || status >= 500) return true;
  const code = String(error.code || "").toLowerCase();
  return code === "aborterror" || code === "etimedout" || code === "ecanceled" || code === "econnreset";
}

async function executeBoundedDependency(operation, options = {}) {
  const {
    attemptTimeoutMs = DEPENDENCY_ATTEMPT_TIMEOUT_MS,
    totalBudgetMs = DEPENDENCY_TOTAL_TIMEOUT_MS,
    jitterMs = DEPENDENCY_RETRY_JITTER_MS
  } = options;

  const startedAt = Date.now();
  let attempt = 0;
  let lastError;

  while (attempt < 2) {
    const elapsed = Date.now() - startedAt;
    const remaining = totalBudgetMs - elapsed;
    if (remaining <= 0) {
      const timeoutError = new Error("Dependency operation timed out");
      timeoutError.code = "dependency_timeout";
      throw timeoutError;
    }

    const timeout = Math.max(1, Math.min(attemptTimeoutMs, remaining));

    try {
      return await operation({ timeout });
    } catch (error) {
      lastError = error;
      const canRetry = attempt === 0 && isTransientDependencyFailure(error);
      if (!canRetry) break;

      const postAttemptElapsed = Date.now() - startedAt;
      const postAttemptRemaining = totalBudgetMs - postAttemptElapsed;
      if (postAttemptRemaining <= 1) break;

      const jitterDelay = Math.min(randomJitter(jitterMs), postAttemptRemaining - 1);
      if (jitterDelay > 0) {
        await sleep(jitterDelay);
      }
    }

    attempt += 1;
  }

  throw lastError;
}

builder.defineCatalogHandler(async (args) => {
  if (args.type !== "series" || args.id !== "onepiece_catalog") {
    return { metas: [] };
  }

  return {
    metas: [
      {
        id: "tt0388629",
        type: "series",
        name: "One Piece",
        poster: "https://images.metahub.space/poster/medium/tt0388629/img"
      }
    ]
  };
});

function cleanTitle(filename) {
  const name = String(filename || "").trim();
  if (!name) return "";
  return name.replace(/\.mp4$/i, "");
}

async function callBrokerResolve(episodeId) {
  if (!B_BASE_URL) {
    throw new Error("Missing B_BASE_URL");
  }

  const u = new URL("/api/resolve", B_BASE_URL);
  u.searchParams.set("episode", episodeId);

  const r = await executeBoundedDependency(async ({ timeout }) => {
    const response = await fetch(u.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(timeout)
    });

    if (!response.ok) {
      const err = new Error(`Broker request failed with status ${response.status}`);
      err.code = "broker_http_error";
      err.statusCode = response.status;
      throw err;
    }

    return response;
  });

  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error("Broker returned non-JSON response");
  }

  if (!data.url || typeof data.url !== "string") {
    throw new Error("Broker returned missing url");
  }

  const filename = data && typeof data.filename === "string" ? data.filename : "";
  return { url: data.url, filename };
}

async function resolveEpisode(episodeId) {
  const id = String(episodeId || "").trim();
  if (!id) {
    throw new Error("Missing episode id");
  }

  const { url, filename } = await callBrokerResolve(id);
  const title = cleanTitle(filename) || "Resolved via Jipi";
  return { url, filename, title, episodeId: id };
}

builder.defineStreamHandler(async (args) => {
  if (args.type !== "series") {
    return { streams: [] };
  }

  const streamId = String(args.id || "");
  if (!streamId.startsWith(IMDB_ID)) {
    return { streams: [] };
  }

  try {
    const resolved = await resolveEpisode(streamId);

    return {
      streams: [
        {
          name: "Jipi",
          title: resolved.title,
          url: resolved.url,
          behaviorHints: { notWebReady: true }
        }
      ]
    };
  } catch {
    return { streams: [] };
  }
});

const addonInterface = builder.getInterface();
addonInterface.resolveEpisode = resolveEpisode;

module.exports = addonInterface;
