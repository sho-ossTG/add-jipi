const DEFAULT_FIXED_TIME = Object.freeze({
  year: "2099",
  month: "01",
  day: "01",
  hour: "12",
  minute: "00",
  second: "00"
});

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

function withFixedJerusalemTime(run, overrides = {}) {
  const originalDateTimeFormat = Intl.DateTimeFormat;
  const fixed = {
    ...DEFAULT_FIXED_TIME,
    ...Object.fromEntries(
      Object.entries(overrides).map(([key, value]) => [key, String(value).padStart(2, "0")])
    )
  };

  Intl.DateTimeFormat = function MockDateTimeFormat() {
    return {
      formatToParts() {
        return [
          { type: "year", value: fixed.year },
          { type: "month", value: fixed.month },
          { type: "day", value: fixed.day },
          { type: "hour", value: fixed.hour },
          { type: "minute", value: fixed.minute },
          { type: "second", value: fixed.second }
        ];
      }
    };
  };

  return Promise.resolve()
    .then(run)
    .finally(() => {
      Intl.DateTimeFormat = originalDateTimeFormat;
    });
}

function setRedisEnv() {
  process.env.KV_REST_API_URL = "https://example-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";
}

function createMockRedisFetch(mode = "allow") {
  return async function fetch(_url, options = {}) {
    const payload = JSON.parse(options.body || "[]");
    const command = Array.isArray(payload) ? payload[0] : [];
    const op = command[0];
    const key = command[1];
    let result = "OK";

    if (op === "GET") {
      if (key === "system:reset:2099-01-01") result = "1";
      else if (String(key || "").startsWith("active:url:")) result = null;
      else if (String(key || "").startsWith("stats:")) result = 0;
      else result = "1";
    }

    if (op === "EVAL") {
      result = mode === "slot-blocked"
        ? [0, "blocked:slot_taken", "", 2]
        : [1, "admitted:new", "", 1];
    }

    if (op === "ZSCORE") result = mode === "slot-blocked" ? null : "1";
    if (op === "ZCARD") result = mode === "slot-blocked" ? 2 : 1;
    if (op === "PING") result = "PONG";

    return {
      ok: true,
      async json() {
        return [{ result }];
      }
    };
  };
}

function loadServerless() {
  delete require.cache[require.resolve("../../serverless")];
  return require("../../serverless");
}

function loadAddon() {
  delete require.cache[require.resolve("../../addon")];
  return require("../../addon");
}

function createRedisRuntime() {
  const state = {
    strings: new Map(),
    sessions: new Map(),
    lists: new Map()
  };

  function sortedSessions() {
    return [...state.sessions.entries()].sort((left, right) => {
      if (left[1] !== right[1]) return left[1] - right[1];
      return left[0].localeCompare(right[0]);
    });
  }

  function evalGate(args) {
    const currentIp = String(args[0]);
    const nowMs = Number(args[1]);
    const pruneCutoff = Number(args[2]);
    const maxSessions = Number(args[3]);
    const reconnectGraceMs = Number(args[5]);
    const idleCutoff = Number(args[6]);

    for (const [ip, score] of [...state.sessions.entries()]) {
      if (score <= pruneCutoff) {
        state.sessions.delete(ip);
      }
    }

    if (state.sessions.has(currentIp)) {
      state.sessions.set(currentIp, nowMs);
      return [1, "admitted:existing", "", state.sessions.size];
    }

    if (state.sessions.size < maxSessions) {
      state.sessions.set(currentIp, nowMs);
      return [1, "admitted:new", "", state.sessions.size];
    }

    let rotation = null;
    for (const [ip, score] of sortedSessions()) {
      if (ip === currentIp) continue;
      const idleEnough = score <= idleCutoff;
      const outsideGrace = (nowMs - score) >= reconnectGraceMs;
      if (!idleEnough || !outsideGrace) continue;
      if (!rotation || score < rotation.score || (score === rotation.score && ip.localeCompare(rotation.ip) < 0)) {
        rotation = { ip, score };
      }
    }

    if (rotation) {
      state.sessions.delete(rotation.ip);
      state.sessions.set(currentIp, nowMs);
      return [1, "admitted:rotated", rotation.ip, state.sessions.size];
    }

    return [0, "blocked:slot_taken", "", state.sessions.size];
  }

  async function fetch(_url, options = {}) {
    const payload = JSON.parse(options.body || "[]");
    const command = Array.isArray(payload) ? payload[0] : [];
    const op = String(command[0] || "").toUpperCase();
    const key = command[1];
    let result = "OK";

    if (op === "GET") {
      result = state.strings.has(key) ? state.strings.get(key) : null;
    }

    if (op === "SET") {
      state.strings.set(key, String(command[2]));
      result = "OK";
    }

    if (op === "DEL") {
      state.strings.delete(key);
      state.lists.delete(key);
      result = 1;
    }

    if (op === "INCR") {
      const current = Number(state.strings.get(key) || 0);
      const next = current + 1;
      state.strings.set(key, String(next));
      result = next;
    }

    if (op === "LPUSH") {
      const list = state.lists.get(key) || [];
      list.unshift(String(command[2] || ""));
      state.lists.set(key, list);
      result = list.length;
    }

    if (op === "LTRIM") {
      const list = state.lists.get(key) || [];
      const start = Number(command[2]);
      const end = Number(command[3]);
      state.lists.set(key, list.slice(start, end + 1));
      result = "OK";
    }

    if (op === "LRANGE") {
      result = state.lists.get(key) || [];
    }

    if (op === "ZCARD") {
      result = state.sessions.size;
    }

    if (op === "ZSCORE") {
      const member = String(command[2] || "");
      result = state.sessions.has(member) ? String(state.sessions.get(member)) : null;
    }

    if (op === "ZREM") {
      result = state.sessions.delete(command[2]) ? 1 : 0;
    }

    if (op === "ZADD") {
      const score = Number(command[2]);
      const member = String(command[3]);
      state.sessions.set(member, score);
      result = 1;
    }

    if (op === "ZREMRANGEBYSCORE") {
      const max = Number(command[3]);
      let removed = 0;
      for (const [member, score] of [...state.sessions.entries()]) {
        if (score <= max) {
          state.sessions.delete(member);
          removed += 1;
        }
      }
      result = removed;
    }

    if (op === "EVAL") {
      const args = command.slice(4);
      result = evalGate(args);
    }

    if (op === "PING") {
      result = "PONG";
    }

    return {
      ok: true,
      async json() {
        return [{ result }];
      }
    };
  }

  return { state, fetch };
}

function createSessionGateRedisEval({
  initialSessions = [],
  reconnectGraceMs = 15000,
  rotationIdleMs = 45000,
  inactivityLimitSec = 20 * 60
} = {}) {
  const sessions = new Map(initialSessions);

  return async function redisEval(_script, _keys, args = []) {
    const ip = String(args[0] || "");
    const nowMs = Number(args[1] || 0);
    const pruneCutoff = Number(args[2] || (nowMs - (inactivityLimitSec * 1000)));
    const maxSessions = Number(args[3] || 2);
    const graceMs = Number(args[5] || reconnectGraceMs);
    const idleCutoff = Number(args[6] || (nowMs - rotationIdleMs));

    for (const [member, score] of [...sessions.entries()]) {
      if (score <= pruneCutoff) {
        sessions.delete(member);
      }
    }

    if (sessions.has(ip)) {
      sessions.set(ip, nowMs);
      return [1, "admitted:existing", "", sessions.size];
    }

    if (sessions.size < maxSessions) {
      sessions.set(ip, nowMs);
      return [1, "admitted:new", "", sessions.size];
    }

    const ordered = [...sessions.entries()].sort((left, right) => {
      if (left[1] !== right[1]) return left[1] - right[1];
      return left[0].localeCompare(right[0]);
    });
    let rotatedIp = "";
    let rotatedScore = Number.POSITIVE_INFINITY;

    for (const [member, score] of ordered) {
      const idleEnough = score <= idleCutoff;
      const outsideGrace = (nowMs - score) >= graceMs;
      if (member === ip || !idleEnough || !outsideGrace) {
        continue;
      }
      if (score < rotatedScore || (score === rotatedScore && member.localeCompare(rotatedIp) < 0)) {
        rotatedIp = member;
        rotatedScore = score;
      }
    }

    if (rotatedIp) {
      sessions.delete(rotatedIp);
      sessions.set(ip, nowMs);
      return [1, "admitted:rotated", rotatedIp, sessions.size];
    }

    return [0, "blocked:slot_taken", "", sessions.size];
  };
}

async function requestWithHandler(handler, pathname, options = {}) {
  const {
    method = "GET",
    ip = "198.51.100.20",
    headers = {},
    jerusalemHour = "12",
    jerusalemMinute = "00",
    jerusalemSecond = "00"
  } = options;

  const req = {
    method,
    url: pathname,
    headers: {
      host: "localhost:3000",
      ...headers
    },
    socket: { remoteAddress: ip }
  };
  const res = createResponse();

  await withFixedJerusalemTime(async () => {
    await handler(req, res);
  }, {
    hour: jerusalemHour,
    minute: jerusalemMinute,
    second: jerusalemSecond
  });

  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: res.body ? JSON.parse(res.body) : null
  };
}

module.exports = {
  createMockRedisFetch,
  createRedisRuntime,
  createResponse,
  createSessionGateRedisEval,
  loadAddon,
  loadServerless,
  requestWithHandler,
  setRedisEnv,
  withFixedJerusalemTime
};
