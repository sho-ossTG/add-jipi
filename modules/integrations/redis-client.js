const DEFAULT_ATTEMPT_TIMEOUT_MS = 900;
const DEFAULT_TOTAL_TIMEOUT_MS = 1800;
const DEFAULT_RETRY_JITTER_MS = 120;
const {
  executeBoundedDependency,
  isTransientDependencyFailure
} = require("./bounded-dependency");

function getRedisConfig(options = {}) {
  const env = options.env || process.env;
  const url = String(options.url || env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || "");
  const token = String(options.token || env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || "");
  return { url, token };
}

function createRedisClient(options = {}) {
  const customFetchImpl = options.fetchImpl;
  const boundedDependency = options.executeBoundedDependency || executeBoundedDependency;
  const staticUrl = options.url;
  const staticToken = options.token;
  const env = options.env;

  function getCurrentConfig() {
    return getRedisConfig({
      env,
      url: staticUrl,
      token: staticToken
    });
  }

  function getFetchImpl() {
    return customFetchImpl || fetch;
  }

  async function command(parts) {
    if (!Array.isArray(parts) || parts.length === 0) {
      throw new Error("Redis command must be a non-empty array");
    }

    const config = getCurrentConfig();

    if (!config.url || !config.token) {
      const err = new Error("Missing Redis configuration");
      err.code = "redis_config_missing";
      throw err;
    }

    const response = await boundedDependency(async ({ timeout }) => {
      const nextResponse = await getFetchImpl()(`${config.url}/pipeline`, {
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
    }, {
      attemptTimeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
      totalBudgetMs: DEFAULT_TOTAL_TIMEOUT_MS,
      jitterMs: DEFAULT_RETRY_JITTER_MS
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
    getConfig: () => ({ ...getCurrentConfig() })
  };
}

module.exports = {
  createRedisClient,
  executeBoundedDependency,
  isTransientDependencyFailure
};
