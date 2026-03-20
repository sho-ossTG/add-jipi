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

function loadServerless() {
  delete require.cache[require.resolve("../../modules/routing/http-handler")];
  delete require.cache[require.resolve("../../serverless")];
  return require("../../serverless");
}

function loadAddon() {
  delete require.cache[require.resolve("../../addon")];
  return require("../../addon");
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
  createResponse,
  loadAddon,
  loadServerless,
  requestWithHandler,
  withFixedJerusalemTime
};
