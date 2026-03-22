// Phase 44-01: RED tests for /ready endpoint. All tests MUST FAIL until implementation is added in plan 44-02.

const test = require("node:test");
const assert = require("node:assert/strict");

const { handlePublicRoute } = require('../modules/routing/http-handler');

// T1: handlePublicRoute is exported from http-handler.js
test("handlePublicRoute is exported as a function", () => {
  assert.equal(typeof handlePublicRoute, 'function');
});

// T2: /ready returns handled: true
test("/ready returns handled: true", () => {
  const sentStatus = [];
  const fakeReq = { method: 'GET', url: '/ready', headers: { host: 'localhost' } };
  const fakeRes = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(body) { sentStatus.push({ code: this.statusCode, body }); }
  };
  const result = handlePublicRoute(fakeReq, fakeRes, '/ready');
  assert.equal(result.handled, true);
});

// T3: /ready sets status 200 on res
test("/ready sets status 200 on res", () => {
  const sentStatus = [];
  const fakeReq = { method: 'GET', url: '/ready', headers: { host: 'localhost' } };
  const fakeRes = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(body) { sentStatus.push({ code: this.statusCode, body }); }
  };
  handlePublicRoute(fakeReq, fakeRes, '/ready');
  assert.equal(fakeRes.statusCode, 200);
});

// T4: /ready response body contains status "ok"
test("/ready response body contains status 'ok'", () => {
  const sentStatus = [];
  const fakeReq = { method: 'GET', url: '/ready', headers: { host: 'localhost' } };
  const fakeRes = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(body) { sentStatus.push({ code: this.statusCode, body }); }
  };
  handlePublicRoute(fakeReq, fakeRes, '/ready');
  assert.equal(sentStatus.length, 1, "res.end must be called once");
  const parsed = JSON.parse(sentStatus[0].body);
  assert.equal(parsed.status, 'ok');
});

// T5: /ready response body contains server "A"
test("/ready response body contains server 'A'", () => {
  const sentStatus = [];
  const fakeReq = { method: 'GET', url: '/ready', headers: { host: 'localhost' } };
  const fakeRes = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(body) { sentStatus.push({ code: this.statusCode, body }); }
  };
  handlePublicRoute(fakeReq, fakeRes, '/ready');
  assert.equal(sentStatus.length, 1, "res.end must be called once");
  const parsed = JSON.parse(sentStatus[0].body);
  assert.equal(parsed.server, 'A');
});

// T6: /ready response body contains checks object with env and metrics fields
test("/ready response body contains checks object with env='ok' and metrics='ok'", () => {
  const sentStatus = [];
  const fakeReq = { method: 'GET', url: '/ready', headers: { host: 'localhost' } };
  const fakeRes = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(body) { sentStatus.push({ code: this.statusCode, body }); }
  };
  handlePublicRoute(fakeReq, fakeRes, '/ready');
  assert.equal(sentStatus.length, 1, "res.end must be called once");
  const parsed = JSON.parse(sentStatus[0].body);
  assert.equal(typeof parsed.checks, 'object');
  assert.equal(parsed.checks.env, 'ok');
  assert.equal(parsed.checks.metrics, 'ok');
});
