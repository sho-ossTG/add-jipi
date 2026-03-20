const test = require("node:test");
const assert = require("node:assert/strict");
const {
  loadAddon,
  loadServerless,
  requestWithHandler
} = require("./helpers/runtime-fixtures");

async function request(handler, pathname, options = {}) {
  const response = await requestWithHandler(handler, pathname, options);
  return {
    statusCode: response.statusCode,
    body: response.body
  };
}

test("dependency timeout maps to deterministic delayed fallback stream", async () => {
  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  const handler = loadServerless();

  try {
    addon.resolveEpisode = async () => {
      const error = new Error("timeout");
      error.code = "dependency_timeout";
      throw error;
    };

    const response = await request(handler, "/stream/series/tt0388629%3A1%3A7.json", { ip: "198.51.100.41" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.streams.length, 1);
    assert.match(response.body.streams[0].url, /^https:\/\//);
    assert.match(response.body.streams[0].title, /temporarily delayed/i);
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

test("dependency unavailable maps to deterministic unavailable fallback stream", async () => {
  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  const handler = loadServerless();

  try {
    addon.resolveEpisode = async () => {
      const error = new Error("D unavailable");
      error.code = "dependency_unavailable";
      error.statusCode = 503;
      throw error;
    };

    const response = await request(handler, "/stream/series/tt0388629%3A1%3A8.json", { ip: "198.51.100.42" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.streams.length, 1);
    assert.match(response.body.streams[0].url, /^https:\/\//);
    assert.match(response.body.streams[0].title, /temporarily unavailable/i);
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

test("validation error maps to deterministic unavailable fallback stream", async () => {
  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  const handler = loadServerless();

  try {
    addon.resolveEpisode = async () => {
      const error = new Error("invalid D payload");
      error.code = "validation_error";
      throw error;
    };

    const response = await request(handler, "/stream/series/tt0388629%3A1%3A9.json", { ip: "198.51.100.43" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.streams.length, 1);
    assert.match(response.body.streams[0].url, /^https:\/\//);
    assert.match(response.body.streams[0].title, /temporarily unavailable/i);
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});

test("invalid D URL (non-HTTPS) returns degraded fallback stream", async () => {
  const addon = loadAddon();
  const originalResolveEpisode = addon.resolveEpisode;
  const handler = loadServerless();

  try {
    addon.resolveEpisode = async () => ({
      url: "ftp://invalid.example.com/video.mp4",
      title: "One Piece S1E6"
    });

    const response = await request(handler, "/stream/series/tt0388629%3A1%3A6.json", { ip: "198.51.100.31" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.streams.length, 1);
    assert.match(response.body.streams[0].url, /^https:\/\//);
  } finally {
    addon.resolveEpisode = originalResolveEpisode;
    delete require.cache[require.resolve("../serverless")];
    delete require.cache[require.resolve("../addon")];
  }
});
