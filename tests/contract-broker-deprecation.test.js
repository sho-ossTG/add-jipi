const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { SOURCES, normalizeSource } = require("../observability/events");

const REPO_ROOT = path.join(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

test("broker client artifact is removed from integrations", () => {
  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, "modules/integrations/" + "broker" + "-client.js")),
    false
  );
});

test("runtime resolver seam no longer references broker transport", () => {
  const streamRouteSource = readRepoFile("modules/routing/stream-route.js");
  const addonSource = readRepoFile("addon.js");

  assert.doesNotMatch(streamRouteSource, new RegExp("injected\\." + "broker" + "Client"));
  assert.doesNotMatch(streamRouteSource, new RegExp("create" + "BrokerClient"));
  assert.doesNotMatch(addonSource, new RegExp("create" + "BrokerClient"));
});

test("canonical source taxonomy is D-first and excludes broker labels", () => {
  assert.deepEqual(Object.values(SOURCES).sort(), ["d", "policy", "redis", "validation"]);
  assert.equal(Object.values(SOURCES).includes("broker"), false);
  assert.equal(normalizeSource("legacy-source", "dependency_unavailable"), "d");
});

test("operator diagnostics use stats:d_error and resolutionErrors naming", () => {
  const operatorRoutesSource = readRepoFile("modules/routing/operator-routes.js");

  assert.match(operatorRoutesSource, /stats:d_error/);
  assert.match(operatorRoutesSource, /resolutionErrors/);
  assert.doesNotMatch(operatorRoutesSource, new RegExp("stats:" + "broker_error"));
  assert.doesNotMatch(operatorRoutesSource, new RegExp("\\b" + "broker" + "Errors\\b"));
});
