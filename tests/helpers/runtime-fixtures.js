const path = require("node:path");

function createMockRequest(options = {}) {
  return {
    method: options.method || "GET",
    url: options.url || "/",
    headers: { ...(options.headers || {}) },
    socket: { remoteAddress: "127.0.0.1" },
    connection: { remoteAddress: "127.0.0.1" }
  };
}

function createMockResponse() {
  const headers = new Map();
  let body = "";

  return {
    statusCode: 200,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    end(chunk = "") {
      body += String(chunk);
    },
    get headers() {
      return Object.fromEntries(headers.entries());
    },
    get body() {
      return body;
    }
  };
}

function loadHttpHandlerWithRouter(runtimeRouter) {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const sdkPath = require.resolve("stremio-addon-sdk", { paths: [projectRoot] });
  const addonPath = path.join(projectRoot, "addon.js");
  const handlerPath = path.join(projectRoot, "modules", "routing", "http-handler.js");

  const previousSdk = require.cache[sdkPath];
  const previousAddon = require.cache[addonPath];
  const previousHandler = require.cache[handlerPath];

  require.cache[sdkPath] = {
    id: sdkPath,
    filename: sdkPath,
    loaded: true,
    exports: {
      getRouter: () => runtimeRouter
    }
  };

  require.cache[addonPath] = {
    id: addonPath,
    filename: addonPath,
    loaded: true,
    exports: {}
  };

  delete require.cache[handlerPath];
  const { createHttpHandler } = require(handlerPath);

  function cleanup() {
    delete require.cache[handlerPath];
    if (previousHandler) {
      require.cache[handlerPath] = previousHandler;
    }

    if (previousSdk) {
      require.cache[sdkPath] = previousSdk;
    } else {
      delete require.cache[sdkPath];
    }

    if (previousAddon) {
      require.cache[addonPath] = previousAddon;
    } else {
      delete require.cache[addonPath];
    }
  }

  return { createHttpHandler, cleanup };
}

async function runHandler(createHttpHandler, requestOptions = {}) {
  const req = createMockRequest(requestOptions);
  const res = createMockResponse();
  await createHttpHandler(req, res);
  return { req, res, statusCode: res.statusCode, headers: res.headers, body: res.body };
}

module.exports = {
  loadHttpHandlerWithRouter,
  runHandler
};
