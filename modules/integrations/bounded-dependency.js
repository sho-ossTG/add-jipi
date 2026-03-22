const DEFAULT_ATTEMPT_TIMEOUT_MS = 60000;
const DEFAULT_TOTAL_TIMEOUT_MS = 60000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_BACKOFF_BASE_MS = 500;
const DEFAULT_BACKOFF_CAP_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Source: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
// Full jitter: delay = random_between(0, min(cap, base * 2^(attempt+1)))
// attempt is 0-indexed: 0 = gap before second attempt, 1 = gap before third attempt.
function fullJitterDelay(attempt, baseMs, capMs) {
  const ceiling = Math.min(capMs, baseMs * Math.pow(2, attempt + 1));
  return Math.floor(Math.random() * Math.max(1, ceiling));
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
    backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
    backoffCapMs = DEFAULT_BACKOFF_CAP_MS,
    safeToRetry = false,
    maxAttempts = DEFAULT_MAX_ATTEMPTS
  } = options;
  const parsedMaxAttempts = Number.parseInt(String(maxAttempts), 10);
  const attemptLimit = Number.isFinite(parsedMaxAttempts) && parsedMaxAttempts > 0
    ? parsedMaxAttempts
    : DEFAULT_MAX_ATTEMPTS;

  const startedAt = Date.now();
  let attempt = 0;
  let lastError;

  while (attempt < attemptLimit) {
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
      const canRetry = safeToRetry && attempt + 1 < attemptLimit && isTransientDependencyFailure(error);
      if (!canRetry) break;

      const postAttemptElapsed = Date.now() - startedAt;
      const postAttemptRemaining = totalBudgetMs - postAttemptElapsed;
      if (postAttemptRemaining <= 1) break;

      const jitterDelay = Math.min(fullJitterDelay(attempt, backoffBaseMs, backoffCapMs), postAttemptRemaining - 1);
      if (jitterDelay > 0) {
        await sleep(jitterDelay);
      }
    }

    attempt += 1;
  }

  throw lastError;
}

module.exports = {
  executeBoundedDependency,
  isTransientDependencyFailure,
  fullJitterDelay
};
