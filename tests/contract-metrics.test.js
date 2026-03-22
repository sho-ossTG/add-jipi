// Phase 44-01: RED tests for metrics module counter implementation. All tests MUST FAIL until observability/metrics.js stubs are replaced in plan 44-02.

const test = require("node:test");
const assert = require("node:assert/strict");

function freshMetrics() {
  delete require.cache[require.resolve('../observability/metrics')];
  return require('../observability/metrics');
}

// T1: incrementReliabilityCounter persists a count
test("incrementReliabilityCounter persists a count - totals.overall is 1 after one increment", async () => {
  const { incrementReliabilityCounter, readReliabilitySummary } = freshMetrics();
  await incrementReliabilityCounter(null, { source: 'd', cause: 'dependency_timeout', routeClass: 'stremio', result: 'degraded' });
  const summary = await readReliabilitySummary(null);
  assert.equal(summary.totals.overall, 1);
  assert.equal(summary.totals.degraded, 1);
});

// T2: multiple increments accumulate
test("multiple increments accumulate - totals.overall is 2 after two increments", async () => {
  const { incrementReliabilityCounter, readReliabilitySummary } = freshMetrics();
  await incrementReliabilityCounter(null, { source: 'd', cause: 'dependency_timeout', routeClass: 'stremio', result: 'degraded' });
  await incrementReliabilityCounter(null, { source: 'd', cause: 'dependency_timeout', routeClass: 'stremio', result: 'degraded' });
  const summary = await readReliabilitySummary(null);
  assert.equal(summary.totals.overall, 2);
});

// T3: different label combinations are counted separately
test("different label combinations are counted separately in byCause", async () => {
  const { incrementReliabilityCounter, readReliabilitySummary } = freshMetrics();
  await incrementReliabilityCounter(null, { source: 'd', cause: 'dependency_timeout', routeClass: 'stremio', result: 'degraded' });
  await incrementReliabilityCounter(null, { source: 'validation', cause: 'validation_invalid_stream_url', routeClass: 'stremio', result: 'degraded' });
  const summary = await readReliabilitySummary(null);
  assert.equal(summary.totals.overall, 2);
  assert.equal(summary.byCause['dependency_timeout'], 1);
  assert.equal(summary.byCause['validation_invalid_stream_url'], 1);
});

// T4: bySource aggregates by source dimension
test("bySource aggregates counts by source dimension", async () => {
  const { incrementReliabilityCounter, readReliabilitySummary } = freshMetrics();
  await incrementReliabilityCounter(null, { source: 'd', cause: 'dependency_timeout', routeClass: 'stremio', result: 'degraded' });
  await incrementReliabilityCounter(null, { source: 'd', cause: 'dependency_unavailable', routeClass: 'stremio', result: 'degraded' });
  await incrementReliabilityCounter(null, { source: 'validation', cause: 'validation_invalid_stream_url', routeClass: 'stremio', result: 'degraded' });
  const summary = await readReliabilitySummary(null);
  assert.equal(summary.bySource['d'], 2);
  assert.equal(summary.bySource['validation'], 1);
});

// T5: result totals split correctly
test("result totals split correctly across success, failure, degraded, overall", async () => {
  const { incrementReliabilityCounter, readReliabilitySummary } = freshMetrics();
  await incrementReliabilityCounter(null, { source: 'd', cause: 'success', routeClass: 'stremio', result: 'success' });
  await incrementReliabilityCounter(null, { source: 'd', cause: 'dependency_timeout', routeClass: 'stremio', result: 'failure' });
  await incrementReliabilityCounter(null, { source: 'd', cause: 'dependency_unavailable', routeClass: 'stremio', result: 'degraded' });
  const summary = await readReliabilitySummary(null);
  assert.equal(summary.totals.success, 1);
  assert.equal(summary.totals.failure, 1);
  assert.equal(summary.totals.degraded, 1);
  assert.equal(summary.totals.overall, 3);
});

// T6: readReliabilitySummary returns required shape with zero totals when no data
test("readReliabilitySummary returns required shape with all expected fields and zero totals when no increments", async () => {
  const { readReliabilitySummary } = freshMetrics();
  const summary = await readReliabilitySummary(null);
  assert.ok('dimensions' in summary, "summary must have dimensions field");
  assert.ok('totals' in summary, "summary must have totals field");
  assert.ok('bySource' in summary, "summary must have bySource field");
  assert.ok('byCause' in summary, "summary must have byCause field");
  assert.ok('byRouteClass' in summary, "summary must have byRouteClass field");
  assert.ok('metrics' in summary, "summary must have metrics field");
  assert.ok('lastUpdated' in summary, "summary must have lastUpdated field");
  assert.equal(summary.totals.overall, 0);
  assert.equal(summary.lastUpdated, null);
});

// T7: lastUpdated is non-null after first increment
test("lastUpdated is non-null ISO string after first increment", async () => {
  const { incrementReliabilityCounter, readReliabilitySummary } = freshMetrics();
  await incrementReliabilityCounter(null, { source: 'd', cause: 'dependency_timeout', routeClass: 'stremio', result: 'degraded' });
  const summary = await readReliabilitySummary(null);
  assert.notEqual(summary.lastUpdated, null);
  assert.equal(typeof summary.lastUpdated, 'string');
});
