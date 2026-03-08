const DEFAULT_ATTEMPT_TIMEOUT_MS = 5000;
const DEFAULT_TOTAL_TIMEOUT_MS = 10000;
const DEFAULT_RETRY_JITTER_MS = 150;
const { executeBoundedDependency } = require("./bounded-dependency");

/**
 * D HTTP Contract (Phase 1 Stub + Interface Lock)
 *
 * POST /api/resolve
 * Request JSON:
 *   {
 *     episodeId: string (required, non-empty)
 *   }
 * Response JSON (2xx):
 *   {
 *     url: string (required, must start with "https://")
 *     filename: string (required, non-empty)
 *   }
 * Error semantics:
 *   - throws code=dependency_unavailable when D_BASE_URL is unset, network fails,
 *     or dependency returns non-2xx response
 *   - throws code=dependency_timeout when bounded dependency total timeout expires
 *   - throws code=validation_error when response body is invalid or malformed
 *
 * POST /api/ua
 * Request JSON:
 *   {
 *     userAgent: string,
 *     episodeId: string,
 *     timestamp: string (ISO datetime)
 *   }
 * Response:
 *   - 2xx expected
 *   - fire-and-forget with silent catch (optional non-rejecting onFailure signal)
 *   - no-op when D_BASE_URL is unset
 *
 */

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function createError(message, code, statusCode) {
  const err = new Error(message);
  err.code = code;
  if (typeof statusCode === "number") {
    err.statusCode = statusCode;
  }
  return err;
}

function validateResolveResponse(payload) {
  if (!payload || typeof payload !== "object") {
    throw createError("D returned invalid payload", "validation_error");
  }

  const resolvedUrl = typeof payload.url === "string" ? payload.url.trim() : "";
  const resolvedFilename = typeof payload.filename === "string" ? payload.filename.trim() : "";

  if (!resolvedUrl || !resolvedUrl.startsWith("https://")) {
    throw createError("D returned invalid url", "validation_error");
  }
  if (!resolvedFilename) {
    throw createError("D returned invalid filename", "validation_error");
  }

  return {
    url: resolvedUrl,
    title: resolvedFilename
  };
}

function createDClient(options = {}) {
  const env = options.env || process.env;
  const baseUrl = String(options.baseUrl || env.D_BASE_URL || "");
  const fetchImpl = options.fetchImpl || fetch;
  const boundedDependency = options.executeBoundedDependency || executeBoundedDependency;
  const attemptTimeoutMs = parsePositiveInteger(options.attemptTimeoutMs || env.D_ATTEMPT_TIMEOUT_MS, DEFAULT_ATTEMPT_TIMEOUT_MS);
  const totalBudgetMs = parsePositiveInteger(options.totalBudgetMs || env.D_TOTAL_TIMEOUT_MS, DEFAULT_TOTAL_TIMEOUT_MS);
  const jitterMs = parsePositiveInteger(options.jitterMs || env.D_RETRY_JITTER_MS, DEFAULT_RETRY_JITTER_MS);

  async function resolveEpisode(episodeId) {
    const id = String(episodeId || "").trim();
    if (!id) {
      throw new Error("Missing episode id");
    }
    if (!baseUrl) {
      throw createError("Missing D_BASE_URL", "dependency_unavailable");
    }

    const resolveUrl = new URL("/api/resolve", baseUrl).toString();

    let response;
    try {
      response = await boundedDependency(async ({ timeout }) => {
        const nextResponse = await fetchImpl(resolveUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ episodeId: id }),
          signal: AbortSignal.timeout(timeout)
        });

        if (!nextResponse.ok) {
          throw createError(
            `D request failed with status ${nextResponse.status}`,
            "d_http_error",
            nextResponse.status
          );
        }

        return nextResponse;
      }, {
        attemptTimeoutMs,
        totalBudgetMs,
        jitterMs
      });
    } catch (error) {
      if (error && error.code === "dependency_timeout") {
        throw error;
      }

      throw createError(
        "D dependency unavailable",
        "dependency_unavailable",
        Number(error && error.statusCode) || undefined
      );
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw createError("D returned non-JSON response", "validation_error");
    }

    return validateResolveResponse(data);
  }

  function forwardUserAgent(userAgent, episodeId, { onFailure } = {}) {
    if (!baseUrl) return;

    const uaUrl = new URL("/api/ua", baseUrl).toString();

    Promise.resolve()
      .then(() => fetchImpl(uaUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          userAgent: String(userAgent || ""),
          episodeId: String(episodeId || ""),
          timestamp: new Date().toISOString()
        })
      }))
      .catch((error) => {
        if (typeof onFailure === "function") {
          try {
            onFailure(error);
          } catch {
            // Best-effort failure signal for caller observability.
          }
        }
      });
  }

  return {
    resolveEpisode,
    forwardUserAgent
  };
}

module.exports = {
  createDClient
};
