const test = require("node:test");
const assert = require("node:assert/strict");
const { createRedisRuntime, setRedisEnv } = require("./helpers/runtime-fixtures");

function createResponse() {
  const headers = {};
  let body = "";

  return {
    headers,
    get body() {
      return body;
    },
    statusCode: 200,
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
    end(chunk) {
      body = chunk ? String(chunk) : "";
    }
  };
}

function loadServerless() {
  delete require.cache[require.resolve("../serverless")];
  return require("../serverless");
}

async function request(pathname, options = {}) {
  const {
    method = "GET",
    fetchImpl,
    headers = {
      authorization: "Bearer top-secret"
    }
  } = options;

  process.env.OPERATOR_TOKEN = "top-secret";
  setRedisEnv();

  const originalFetch = global.fetch;
  global.fetch = fetchImpl;

  const handler = loadServerless();
  const req = {
    method,
    url: pathname,
    headers: {
      host: "localhost:3000",
      ...headers
    },
    socket: { remoteAddress: "198.51.100.40" }
  };
  const res = createResponse();

  try {
    await handler(req, res);
    let body = null;
    if (res.body) {
      try {
        body = JSON.parse(res.body);
      } catch {
        body = null;
      }
    }
    return {
      statusCode: res.statusCode,
      body,
      rawBody: res.body
    };
  } finally {
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../serverless")];
  }
}

function seedQuarantineEvents(runtime, events) {
  runtime.state.lists.set("quarantine:events", events.map((entry) => JSON.stringify(entry)));
}

function createRedisFailureFetch() {
  return async function redisFailureFetch() {
    return {
      ok: false,
      status: 503,
      async json() {
        return [{ error: "upstash_unavailable" }];
      }
    };
  };
}

function createRuntimeFetchWithLrem(runtime) {
  return async function runtimeFetch(url, options = {}) {
    const payload = JSON.parse(options.body || "[]");
    const command = Array.isArray(payload) ? payload[0] : [];
    const op = String(command[0] || "").toUpperCase();

    if (op === "LREM") {
      const key = String(command[1] || "");
      const count = Number(command[2] || 0);
      const rawValue = String(command[3] || "");
      const list = runtime.state.lists.get(key) || [];
      let removed = 0;

      if (count >= 0) {
        const maxRemovals = count === 0 ? Number.POSITIVE_INFINITY : count;
        for (let index = 0; index < list.length && removed < maxRemovals; index += 1) {
          if (list[index] !== rawValue) {
            continue;
          }
          list.splice(index, 1);
          removed += 1;
          index -= 1;
        }
      }

      runtime.state.lists.set(key, list);
      return {
        ok: true,
        async json() {
          return [{ result: removed }];
        }
      };
    }

    return runtime.fetch(url, options);
  };
}

test("GET /operator/logs/pending returns only events for requested day without deleting data", async () => {
  const runtime = createRedisRuntime();
  const redisFetch = createRuntimeFetchWithLrem(runtime);
  seedQuarantineEvents(runtime, [
    { episodeId: "ep-1", error: "timeout", time: "2099-01-01T12:00:00.000Z" },
    { episodeId: "ep-2", error: "unavailable", time: "2099-01-02T03:00:00.000Z" },
    { episodeId: "ep-3", error: "validation", time: "2099-01-01T22:59:00.000Z" }
  ]);

  const response = await request("/operator/logs/pending?day=2099-01-01", {
    fetchImpl: redisFetch
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    day: "2099-01-01",
    events: [
      { episodeId: "ep-1", error: "timeout", time: "2099-01-01T12:00:00.000Z" },
      { episodeId: "ep-3", error: "validation", time: "2099-01-01T22:59:00.000Z" }
    ]
  });
  assert.equal(runtime.state.lists.get("quarantine:events").length, 3);
});

test("GET /operator/logs/pending returns stable empty payload for day without events", async () => {
  const runtime = createRedisRuntime();
  const redisFetch = createRuntimeFetchWithLrem(runtime);
  seedQuarantineEvents(runtime, [
    { episodeId: "ep-9", error: "timeout", time: "2099-01-03T02:10:00.000Z" }
  ]);

  const response = await request("/operator/logs/pending?day=2099-01-01", {
    fetchImpl: redisFetch
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    day: "2099-01-01",
    events: []
  });
});

test("DELETE /operator/logs/pending removes only events for requested day and returns removed count", async () => {
  const runtime = createRedisRuntime();
  const redisFetch = createRuntimeFetchWithLrem(runtime);
  seedQuarantineEvents(runtime, [
    { episodeId: "ep-1", error: "timeout", time: "2099-01-01T12:00:00.000Z" },
    { episodeId: "ep-2", error: "unavailable", time: "2099-01-02T03:00:00.000Z" },
    { episodeId: "ep-3", error: "validation", time: "2099-01-01T22:59:00.000Z" }
  ]);

  const response = await request("/operator/logs/pending?day=2099-01-01", {
    method: "DELETE",
    fetchImpl: redisFetch
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    day: "2099-01-01",
    removed: 2
  });

  const remainingRaw = runtime.state.lists.get("quarantine:events") || [];
  assert.equal(remainingRaw.length, 1);
  assert.deepEqual(JSON.parse(remainingRaw[0]), {
    episodeId: "ep-2",
    error: "unavailable",
    time: "2099-01-02T03:00:00.000Z"
  });
});

test("DELETE /operator/logs/pending is idempotent for empty or already-cleared day", async () => {
  const runtime = createRedisRuntime();
  const redisFetch = createRuntimeFetchWithLrem(runtime);
  seedQuarantineEvents(runtime, [
    { episodeId: "ep-8", error: "timeout", time: "2099-01-02T08:00:00.000Z" }
  ]);

  const response = await request("/operator/logs/pending?day=2099-01-01", {
    method: "DELETE",
    fetchImpl: redisFetch
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    day: "2099-01-01",
    removed: 0
  });
  assert.equal(runtime.state.lists.get("quarantine:events").length, 1);
});

test("GET and DELETE return deterministic invalid_day error for missing or malformed day", async () => {
  const runtime = createRedisRuntime();
  const redisFetch = createRuntimeFetchWithLrem(runtime);
  seedQuarantineEvents(runtime, [
    { episodeId: "ep-1", error: "timeout", time: "2099-01-01T12:00:00.000Z" }
  ]);

  const missingDay = await request("/operator/logs/pending", {
    fetchImpl: redisFetch
  });
  assert.equal(missingDay.statusCode, 400);
  assert.deepEqual(missingDay.body, { error: "invalid_day" });

  const invalidDay = await request("/operator/logs/pending?day=2099-1-1", {
    fetchImpl: redisFetch
  });
  assert.equal(invalidDay.statusCode, 400);
  assert.deepEqual(invalidDay.body, { error: "invalid_day" });

  const invalidDelete = await request("/operator/logs/pending?day=2099-13-40", {
    method: "DELETE",
    fetchImpl: redisFetch
  });
  assert.equal(invalidDelete.statusCode, 400);
  assert.deepEqual(invalidDelete.body, { error: "invalid_day" });
});

test("GET and DELETE return dependency_unavailable when Redis is unavailable", async () => {
  const failingFetch = createRedisFailureFetch();

  const readResponse = await request("/operator/logs/pending?day=2099-01-01", {
    fetchImpl: failingFetch
  });
  assert.equal(readResponse.statusCode, 503);
  assert.deepEqual(readResponse.body, { error: "dependency_unavailable" });

  const deleteResponse = await request("/operator/logs/pending?day=2099-01-01", {
    method: "DELETE",
    fetchImpl: failingFetch
  });
  assert.equal(deleteResponse.statusCode, 503);
  assert.deepEqual(deleteResponse.body, { error: "dependency_unavailable" });
});
