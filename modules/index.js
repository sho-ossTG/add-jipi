"use strict";

module.exports = Object.freeze({
  purpose: "maintainer-manifest-only",
  guidance:
    "This file is a module ownership/import map for maintainers and review tooling. Do not import from runtime entrypoints.",
  boundaries: {
    map: "./BOUNDARIES.md"
  },
  policy: {
    timeWindow: "./policy/time-window",
    sessionGate: "./policy/session-gate",
    operatorAuth: "./policy/operator-auth"
  },
  integrations: {
    redisClient: "./integrations/redis-client",
    brokerClient: "./integrations/broker-client"
  },
  presentation: {
    streamPayloads: "./presentation/stream-payloads"
  },
  routing: {
    requestControls: "./routing/request-controls",
    streamRoute: "./routing/stream-route",
    operatorRoutes: "./routing/operator-routes"
  },
  maintainerNotes: {
    updateWhen: "module entrypoints are added, renamed, or moved",
    runtimeRule: "Runtime code imports concern modules directly (for example ./routing/http-handler)."
  }
});
