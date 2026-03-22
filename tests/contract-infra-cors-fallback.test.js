const test = require("node:test");
const assert = require("node:assert/strict");
const vercelConfig = require("../vercel.json");

function getCatchAllHeadersRule() {
  const headers = Array.isArray(vercelConfig.headers) ? vercelConfig.headers : [];
  return headers.find((rule) => rule && rule.source === "/(.*)");
}

function getHeaderValue(rule, key) {
  if (!rule || !Array.isArray(rule.headers)) {
    return undefined;
  }

  const match = rule.headers.find((item) => item && item.key === key);
  return match ? match.value : undefined;
}

test("vercel config defines catch-all headers fallback rule", () => {
  const rule = getCatchAllHeadersRule();
  assert.ok(rule, "Expected a headers rule for /(.*)");
});

test("fallback rule allows all origins", () => {
  const rule = getCatchAllHeadersRule();
  assert.equal(getHeaderValue(rule, "Access-Control-Allow-Origin"), "*");
});

test("fallback rule sets methods and headers contract", () => {
  const rule = getCatchAllHeadersRule();
  assert.equal(getHeaderValue(rule, "Access-Control-Allow-Methods"), "GET,OPTIONS");
  assert.equal(
    getHeaderValue(rule, "Access-Control-Allow-Headers"),
    "content-type,authorization,x-operator-token"
  );
});
