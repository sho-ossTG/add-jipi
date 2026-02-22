const crypto = require("node:crypto");

function secureEquals(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function extractOperatorToken(headers = {}) {
  const authHeader = headers.authorization;
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  const headerToken = headers["x-operator-token"];
  if (typeof headerToken === "string" && headerToken.trim()) {
    return headerToken.trim();
  }

  return "";
}

function authorizeOperator(input = {}) {
  const expectedToken = String(input.expectedToken || "");
  if (!expectedToken) {
    return { allowed: false, statusCode: 401, error: "operator_auth_unconfigured" };
  }

  const providedToken = extractOperatorToken(input.headers || {});
  if (!providedToken) {
    return { allowed: false, statusCode: 401, error: "operator_token_required" };
  }

  if (!secureEquals(providedToken, expectedToken)) {
    return { allowed: false, statusCode: 403, error: "operator_forbidden" };
  }

  return { allowed: true };
}

module.exports = {
  authorizeOperator,
  extractOperatorToken,
  secureEquals
};
