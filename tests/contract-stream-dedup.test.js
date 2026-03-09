const test = require("node:test");
const assert = require("node:assert/strict");

const { handleStreamRequest } = require("../modules/routing/stream-route");

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(chunk) {
      this.body = chunk ? JSON.parse(String(chunk)) : null;
    }
  };
}

function createRedisCommand() {
  const strings = new Map();

  return async function redisCommand(parts = []) {
    const op = String(parts[0] || "").toUpperCase();
    const key = String(parts[1] || "");

    if (op === "GET") {
      return strings.has(key) ? strings.get(key) : null;
    }

    if (op === "SET") {
      const value = String(parts[2] || "");
      const hasNx = parts.some((item) => String(item).toUpperCase() === "NX");
      if (hasNx && strings.has(key)) {
        return null;
      }
      strings.set(key, value);
      return "OK";
    }

    if (op === "DEL") {
      return strings.delete(key) ? 1 : 0;
    }

    return "OK";
  };
}

async function executeStream(pathname, ip, injected = {}) {
  const req = {
    headers: {
      host: "localhost:3000",
      "user-agent": "contract-test-agent"
    }
  };
  const res = createResponse();

  const result = await handleStreamRequest(
    { req, res, pathname, ip },
    {
      ...injected,
      isSupportedEpisode: () => true,
      sendJson: (_req, response, statusCode, payload) => {
        response.statusCode = statusCode;
        response.end(JSON.stringify(payload));
      },
      sendDegradedStream: (_req, response, causeInput) => {
        const cause = typeof causeInput === "string"
          ? causeInput
          : String(causeInput && causeInput.code || "dependency_unavailable");
        response.statusCode = 200;
        response.end(JSON.stringify({ streams: [], notice: cause }));
      },
      formatStream: (title, url) => ({ title, url })
    }
  );

  return {
    result,
    statusCode: res.statusCode,
    body: res.body
  };
}

test("duplicate same-episode+same-IP requests wait and share one success result", async () => {
  const redisCommand = createRedisCommand();
  let resolveCount = 0;
  const resolveEpisode = async () => {
    resolveCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return {
      url: "https://cdn.example.com/onepiece-1-30.mp4",
      title: "One Piece S1E30"
    };
  };

  const [first, duplicate] = await Promise.all([
    executeStream("/stream/series/tt0388629%3A1%3A30.json", "198.51.100.88", {
      redisCommand,
      resolveEpisode,
      dedupPollIntervalMs: 5,
      dedupWaitTimeoutMs: 2000
    }),
    executeStream("/stream/series/tt0388629%3A1%3A30.json", "198.51.100.88", {
      redisCommand,
      resolveEpisode,
      dedupPollIntervalMs: 5,
      dedupWaitTimeoutMs: 2000
    })
  ]);

  assert.equal(resolveCount, 1);
  assert.equal(first.statusCode, 200);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(first.body.streams.length, 1);
  assert.equal(duplicate.body.streams.length, 1);
  assert.deepEqual(duplicate.body, first.body);
});

test("first-request failure marker is reused by waiting duplicate without retrying D", async () => {
  const redisCommand = createRedisCommand();
  let resolveCount = 0;
  const resolveEpisode = async () => {
    resolveCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const error = new Error("D timed out");
    error.code = "dependency_timeout";
    throw error;
  };
  const classifyFailure = ({ error, reason }) => ({
    source: "d",
    cause: String(reason || (error && error.code) || "dependency_unavailable")
  });

  const [first, duplicate] = await Promise.all([
    executeStream("/stream/series/tt0388629%3A1%3A31.json", "198.51.100.89", {
      redisCommand,
      resolveEpisode,
      classifyFailure,
      dedupPollIntervalMs: 5,
      dedupWaitTimeoutMs: 2000
    }),
    executeStream("/stream/series/tt0388629%3A1%3A31.json", "198.51.100.89", {
      redisCommand,
      resolveEpisode,
      classifyFailure,
      dedupPollIntervalMs: 5,
      dedupWaitTimeoutMs: 2000
    })
  ]);

  assert.equal(resolveCount, 1);
  assert.equal(first.statusCode, 200);
  assert.equal(duplicate.statusCode, 200);
  assert.deepEqual(first.body, { streams: [], notice: "dependency_timeout" });
  assert.deepEqual(duplicate.body, first.body);
});
