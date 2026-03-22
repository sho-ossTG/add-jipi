const test = require("node:test");
const assert = require("node:assert/strict");

const addon = require("../addon");
const pkg = require("../package.json");

const REQUIRED_FIELDS = [
  "id",
  "version",
  "name",
  "description",
  "resources",
  "types",
  "catalogs",
  "idPrefixes"
];

test("manifest version matches package version", () => {
  assert.equal(addon.manifest.version, pkg.version);
});

test("manifest includes required Stremio contract fields", () => {
  for (const field of REQUIRED_FIELDS) {
    assert.notEqual(addon.manifest[field], undefined);
  }
});

test("manifest exposes reliability configuration hint", () => {
  assert.equal(addon.manifest.behaviorHints.configurationRequired, false);
});
