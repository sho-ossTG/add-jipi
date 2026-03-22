// Phase 44-01: RED tests for stream-route.js emitEvent callsites. All tests MUST FAIL until callsites are added in plan 44-02.

const test = require("node:test");
const assert = require("node:assert/strict");

// Patch the events module in require.cache before requiring stream-route so the spy intercepts calls.
// stream-route.js requires observability/events at module load time, so we bust and re-require.
function makeStreamRouteWithSpy(emitEventCalls) {
  // Patch events module in cache with spy
  const eventsPath = require.resolve('../observability/events');
  const realEvents = require(eventsPath);
  const patchedEvents = Object.assign({}, realEvents, {
    emitEvent(...args) {
      emitEventCalls.push(args);
      return {};
    }
  });
  require.cache[eventsPath] = { id: eventsPath, filename: eventsPath, loaded: true, exports: patchedEvents };

  // Bust stream-route cache so it picks up the patched events module
  const streamRoutePath = require.resolve('../modules/routing/stream-route');
  delete require.cache[streamRoutePath];
  const freshStreamRoute = require(streamRoutePath);

  return freshStreamRoute;
}

function makeBaseInjected(overrides = {}) {
  return {
    sendJson: () => {},
    sendDegradedStream: () => {},
    streamCache: {
      get: () => ({ hit: false }),
      set: () => {},
      setNegative: () => {}
    },
    concurrencyGuard: { execute: (_key, operation) => operation() },
    forwardUserAgent: async () => {},
    isSupportedEpisode: (id) => id.startsWith('tt0388629'),
    ...overrides
  };
}

// T1: emitEvent called in catch block when dependency throws
test("emitEvent is called with DEPENDENCY_FAILURE event when dependency throws in catch block", async () => {
  const emitEventCalls = [];
  const { handleStreamRequest } = makeStreamRouteWithSpy(emitEventCalls);

  const injected = makeBaseInjected({
    resolveEpisode: async () => { throw new Error('timeout'); },
    classifyFailure: () => ({ source: 'd', cause: 'dependency_timeout' })
  });

  await handleStreamRequest(
    { req: { headers: {} }, res: {}, pathname: '/stream/series/tt0388629%3A1%3A1.json', ip: '127.0.0.1' },
    injected
  );

  assert.ok(emitEventCalls.length >= 1, `emitEvent must be called at least once in catch block, but was called ${emitEventCalls.length} times`);

  const dependencyFailureCall = emitEventCalls.find(args => args[1] === 'dependency.failure');
  assert.ok(dependencyFailureCall !== undefined, "emitEvent must be called with 'dependency.failure' event name");

  const payload = dependencyFailureCall[2] || {};
  assert.equal(payload.source, 'd', "emitEvent payload must have source: 'd'");
});

// T2: emitEvent called at empty-URL guard when finalUrl is invalid
test("emitEvent is called with DEPENDENCY_FAILURE event at empty-URL guard when finalUrl is invalid", async () => {
  const emitEventCalls = [];
  const { handleStreamRequest } = makeStreamRouteWithSpy(emitEventCalls);

  const injected = makeBaseInjected({
    resolveEpisode: async () => ({ url: '', title: 'Episode 1' }),
    classifyFailure: () => ({ source: 'validation', cause: 'validation_invalid_stream_url' })
  });

  await handleStreamRequest(
    { req: { headers: {} }, res: {}, pathname: '/stream/series/tt0388629%3A1%3A2.json', ip: '127.0.0.1' },
    injected
  );

  assert.ok(emitEventCalls.length >= 1, `emitEvent must be called at least once at URL guard, but was called ${emitEventCalls.length} times`);

  const dependencyFailureCall = emitEventCalls.find(args => args[1] === 'dependency.failure');
  assert.ok(dependencyFailureCall !== undefined, "emitEvent must be called with 'dependency.failure' event name at URL guard");

  const payload = dependencyFailureCall[2] || {};
  assert.equal(payload.source, 'validation', "emitEvent payload must have source: 'validation'");
  assert.equal(payload.cause, 'validation_invalid_stream_url', "emitEvent payload must have cause: 'validation_invalid_stream_url'");
});
