const test = require("node:test");
const assert = require("node:assert/strict");
const {
  executeBoundedDependency,
  isTransientDependencyFailure
} = require("../modules/integrations/bounded-dependency");

test("isTransientDependencyFailure identifies retriable status and network codes", () => {
  assert.equal(isTransientDependencyFailure({ statusCode: 500 }), true);
  assert.equal(isTransientDependencyFailure({ statusCode: 429 }), true);
  assert.equal(isTransientDependencyFailure({ statusCode: 408 }), true);
  assert.equal(isTransientDependencyFailure({ code: "ETIMEDOUT" }), true);
  assert.equal(isTransientDependencyFailure({ code: "ECONNRESET" }), true);
  assert.equal(isTransientDependencyFailure({ statusCode: 404 }), false);
  assert.equal(isTransientDependencyFailure({ code: "EACCES" }), false);
  assert.equal(isTransientDependencyFailure(null), false);
});

test("executeBoundedDependency retries once on transient failure", async () => {
  let calls = 0;

  const result = await executeBoundedDependency(async () => {
    calls += 1;
    if (calls === 1) {
      const error = new Error("temporary failure");
      error.statusCode = 503;
      throw error;
    }
    return "ok";
  }, { jitterMs: 0 });

  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("executeBoundedDependency honors maxAttempts for transient failures", async () => {
  let calls = 0;

  const result = await executeBoundedDependency(async () => {
    calls += 1;
    if (calls < 3) {
      const error = new Error("temporary failure");
      error.statusCode = 503;
      throw error;
    }
    return "ok";
  }, {
    jitterMs: 0,
    maxAttempts: 3
  });

  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("executeBoundedDependency does not retry non-transient failure", async () => {
  let calls = 0;

  await assert.rejects(async () => executeBoundedDependency(async () => {
    calls += 1;
    const error = new Error("bad request");
    error.statusCode = 400;
    throw error;
  }, {
    jitterMs: 0,
    maxAttempts: 3
  }), {
    message: "bad request"
  });

  assert.equal(calls, 1);
});

test("executeBoundedDependency enforces total timeout budget", async () => {
  let calls = 0;

  await assert.rejects(async () => executeBoundedDependency(async () => {
    calls += 1;
    return "never";
  }, {
    attemptTimeoutMs: 50,
    totalBudgetMs: 0,
    jitterMs: 0
  }), {
    code: "dependency_timeout"
  });

  assert.equal(calls, 0);
});

test("executeBoundedDependency passes bounded timeout to operation", async () => {
  const observed = [];

  await assert.rejects(async () => executeBoundedDependency(async ({ timeout }) => {
    observed.push(timeout);
    throw new Error("stop");
  }, {
    attemptTimeoutMs: 100,
    totalBudgetMs: 30,
    jitterMs: 0
  }), {
    message: "stop"
  });

  assert.equal(observed.length, 1);
  assert.equal(Number.isInteger(observed[0]), true);
  assert.equal(observed[0] > 0, true);
  assert.equal(observed[0] <= 30, true);
});
