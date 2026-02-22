module.exports = {
  boundaries: {
    map: "./BOUNDARIES.md"
  },
  policy: {
    timeWindow: require("./policy/time-window"),
    sessionGate: require("./policy/session-gate"),
    operatorAuth: require("./policy/operator-auth")
  },
  integrations: {
    redisClient: require("./integrations/redis-client"),
    brokerClient: require("./integrations/broker-client")
  },
  presentation: {
    streamPayloads: require("./presentation/stream-payloads")
  },
  routing: {
    requestControls: require("./routing/request-controls"),
    streamRoute: require("./routing/stream-route"),
    operatorRoutes: require("./routing/operator-routes")
  }
};
