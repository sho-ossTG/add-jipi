const DEFAULT_ATTEMPT_TIMEOUT_MS = 900;
const DEFAULT_TOTAL_TIMEOUT_MS = 1800;
const DEFAULT_RETRY_JITTER_MS = 120;

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
    attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
    totalBudgetMs = DEFAULT_TOTAL_TIMEOUT_MS,
    jitterMs = DEFAULT_RETRY_JITTER_MS
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

function cleanTitle(filename) {
  const name = String(filename || "").trim();
  if (!name) return "";
  return name.replace(/\.mp4$/i, "");
}

function createBrokerClient(options = {}) {
  const baseUrl = String(options.baseUrl || process.env.B_BASE_URL || "");
  const fetchImpl = options.fetchImpl || fetch;
  const boundedDependency = options.executeBoundedDependency || executeBoundedDependency;

  async function resolveEpisode(episodeId) {
    const id = String(episodeId || "").trim();
    if (!id) {
      throw new Error("Missing episode id");
    }
    if (!baseUrl) {
      throw new Error("Missing B_BASE_URL");
    }

    const url = new URL("/api/resolve", baseUrl);
    url.searchParams.set("episode", id);

    const response = await boundedDependency(async ({ timeout }) => {
      const nextResponse = await fetchImpl(url.toString(), {
        method: "GET",
        signal: AbortSignal.timeout(timeout)
      });

      if (!nextResponse.ok) {
        const err = new Error(`Broker request failed with status ${nextResponse.status}`);
        err.code = "broker_http_error";
        err.statusCode = nextResponse.status;
        throw err;
      }

      return nextResponse;
    });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("Broker returned non-JSON response");
    }

    if (!data || typeof data.url !== "string" || !data.url) {
      throw new Error("Broker returned missing url");
    }

    return {
      url: data.url,
      filename: typeof data.filename === "string" ? data.filename : "",
      title: cleanTitle(data.filename) || "Resolved via Jipi",
      episodeId: id
    };
  }

  return {
    resolveEpisode
  };
}

module.exports = {
  createBrokerClient,
  executeBoundedDependency,
  isTransientDependencyFailure
};
