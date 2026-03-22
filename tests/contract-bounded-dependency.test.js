const test = require("node:test");
const assert = require("node:assert/strict");
const { executeBoundedDependency } = require("../modules/integrations/bounded-dependency");

// Plan 41-01: RED tests for bounded-dependency Phase 41 behaviors.
// These tests MUST fail against the unmodified bounded-dependency.js because:
//   - Tests A/B/C/D/E reference safeToRetry option which does not exist yet
//   - Test F references fullJitterDelay export which does not exist yet
//   - Test G exercises backward-compat guard (safeToRetry=false must suppress retry)
//
// All retry tests pass backoffBaseMs:0 and backoffCapMs:0 to eliminate real sleep delays.

// Test A: safeToRetry=false — transient 503 error is NOT retried (calls===1)
test("safeToRetry false: no retry on transient 503 failure", async () => {
  let calls = 0;
  const transientError = new Error("server error");
  transientError.statusCode = 503;

  await assert.rejects(
    () => executeBoundedDependency(
      async () => { calls++; throw transientError; },
      {
        safeToRetry: false,
        maxAttempts: 3,
        backoffBaseMs: 0,
        backoffCapMs: 0,
        attemptTimeoutMs: 5000,
        totalBudgetMs: 5000
      }
    ),
    { message: "server error" }
  );
  assert.equal(calls, 1, "safeToRetry=false must suppress retry; expected 1 call");
});

// Test B: safeToRetry=true — operation that always throws 503 exhausts all maxAttempts (calls===3)
test("safeToRetry true: exhausts all attempts on persistent transient failure", async () => {
  let calls = 0;
  const transientError = new Error("server error");
  transientError.statusCode = 503;

  await assert.rejects(
    () => executeBoundedDependency(
      async () => { calls++; throw transientError; },
      {
        safeToRetry: true,
        maxAttempts: 3,
        backoffBaseMs: 0,
        backoffCapMs: 0,
        attemptTimeoutMs: 5000,
        totalBudgetMs: 5000
      }
    )
  );
  assert.equal(calls, 3, "safeToRetry=true must retry up to maxAttempts; expected 3 calls");
});

// Test C: safeToRetry=true — operation throws 503 on first call only, succeeds on second
test("safeToRetry true: succeeds on second attempt after transient failure", async () => {
  let calls = 0;
  const transientError = new Error("server error");
  transientError.statusCode = 503;

  const result = await executeBoundedDependency(
    async () => {
      calls++;
      if (calls < 2) throw transientError;
      return "ok";
    },
    {
      safeToRetry: true,
      maxAttempts: 3,
      backoffBaseMs: 0,
      backoffCapMs: 0,
      attemptTimeoutMs: 5000,
      totalBudgetMs: 5000
    }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 2, "expected exactly 2 calls: one failure then one success");
});

// Test D: safeToRetry=false, non-transient 400 — operation called exactly once
test("safeToRetry false: no retry on non-transient 400 failure", async () => {
  let calls = 0;
  const clientError = new Error("bad request");
  clientError.statusCode = 400;

  await assert.rejects(
    () => executeBoundedDependency(
      async () => { calls++; throw clientError; },
      {
        safeToRetry: false,
        maxAttempts: 3,
        backoffBaseMs: 0,
        backoffCapMs: 0,
        attemptTimeoutMs: 5000,
        totalBudgetMs: 5000
      }
    ),
    { message: "bad request" }
  );
  assert.equal(calls, 1, "non-transient error with safeToRetry=false must not retry; expected 1 call");
});

// Test E: safeToRetry=true, non-transient 400 — no retry because error is not transient
test("safeToRetry true: no retry on non-transient 400 failure (isTransientDependencyFailure returns false)", async () => {
  let calls = 0;
  const clientError = new Error("bad request");
  clientError.statusCode = 400;

  await assert.rejects(
    () => executeBoundedDependency(
      async () => { calls++; throw clientError; },
      {
        safeToRetry: true,
        maxAttempts: 3,
        backoffBaseMs: 0,
        backoffCapMs: 0,
        attemptTimeoutMs: 5000,
        totalBudgetMs: 5000
      }
    ),
    { message: "bad request" }
  );
  assert.equal(calls, 1, "400 is non-transient; even with safeToRetry=true must not retry; expected 1 call");
});

// Test F: fullJitterDelay export — formula ceiling is correct
// Formula: ceiling = min(cap, base * 2^(attempt+1))  (attempt is 0-indexed retry gap)
//   attempt=0: min(2000, 500*2^1) = min(2000, 1000) = 1000; floor(0.9999 * 1000) = 999
//   attempt=1: min(2000, 500*2^2) = min(2000, 2000) = 2000; floor(0.9999 * 2000) = 1999
// fullJitterDelay is NOT exported yet — this test is RED by design until Plan 02.
test("fullJitterDelay: ceiling formula is correct for attempt 0 and attempt 1", () => {
  const { fullJitterDelay } = require("../modules/integrations/bounded-dependency");
  const savedRandom = Math.random;
  try {
    Math.random = () => 0.9999;
    assert.equal(fullJitterDelay(0, 500, 2000), 999, "attempt=0 ceiling should be 1000, result 999");
    assert.equal(fullJitterDelay(1, 500, 2000), 1999, "attempt=1 ceiling should be 2000, result 1999");
  } finally {
    Math.random = savedRandom;
  }
});

// Test G: old jitterMs param not forwarded — passing jitterMs must not affect retry behavior.
// After implementation, safeToRetry=false gates retry before any delay is computed; jitterMs is ignored.
test("jitterMs param is not used: passing jitterMs with safeToRetry=false still results in 1 call", async () => {
  let calls = 0;
  const transientError = new Error("server error");
  transientError.statusCode = 503;

  await assert.rejects(
    () => executeBoundedDependency(
      async () => { calls++; throw transientError; },
      {
        safeToRetry: false,
        maxAttempts: 3,
        backoffBaseMs: 0,
        backoffCapMs: 0,
        jitterMs: 0,
        attemptTimeoutMs: 5000,
        totalBudgetMs: 5000
      }
    )
  );
  assert.equal(calls, 1, "jitterMs must be ignored; safeToRetry=false suppresses retry; expected 1 call");
});
