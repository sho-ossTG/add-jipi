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

function getRedisConfig(options = {}) {
  const env = options.env || process.env;
  const url = String(options.url || env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || "");
  const token = String(options.token || env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || "");
  return { url, token };
}

function createRedisClient(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const boundedDependency = options.executeBoundedDependency || executeBoundedDependency;
  const config = getRedisConfig(options);

  async function command(parts) {
    if (!Array.isArray(parts) || parts.length === 0) {
      throw new Error("Redis command must be a non-empty array");
    }

    if (!config.url || !config.token) {
      const err = new Error("Missing Redis configuration");
      err.code = "redis_config_missing";
      throw err;
    }

    const response = await boundedDependency(async ({ timeout }) => {
      const nextResponse = await fetchImpl(`${config.url}/pipeline`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify([parts]),
        signal: AbortSignal.timeout(timeout)
      });

      if (!nextResponse.ok) {
        const err = new Error(`Redis request failed with status ${nextResponse.status}`);
        err.code = "redis_http_error";
        err.statusCode = nextResponse.status;
        throw err;
      }

      return nextResponse;
    });

    const data = await response.json();
    const item = Array.isArray(data) ? data[0] : null;
    if (!item || item.error) {
      const err = new Error(item && item.error ? item.error : "Invalid Redis response");
      err.code = "redis_response_error";
      throw err;
    }

    return item.result;
  }

  async function evalScript(script, keys = [], args = []) {
    const commandParts = [
      "EVAL",
      script,
      String(keys.length),
      ...keys,
      ...args.map((value) => String(value))
    ];
    return command(commandParts);
  }

  return {
    command,
    eval: evalScript,
    getConfig: () => ({ ...config })
  };
}

module.exports = {
  createRedisClient,
  executeBoundedDependency,
  isTransientDependencyFailure
};
