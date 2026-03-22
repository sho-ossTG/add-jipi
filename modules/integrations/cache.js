function createCache(options = {}) {
  const positiveTtlMs = options.positiveTtlMs !== undefined ? Number(options.positiveTtlMs) : 3600 * 1000;
  const staleWindowMs = options.staleWindowMs !== undefined ? Number(options.staleWindowMs) : 14400 * 1000;
  const negativeTtlMs = options.negativeTtlMs !== undefined ? Number(options.negativeTtlMs) : 300 * 1000;
  const nowFn = options.nowFn || Date.now;

  const store = new Map();

  function get(key) {
    const entry = store.get(key);
    if (!entry) return { hit: false };
    const age = nowFn() - entry.setAt;
    if (entry.type === "negative") {
      if (age >= entry.ttlMs) { store.delete(key); return { hit: false }; }
      return { hit: true, negative: true };
    }
    // positive
    if (age < entry.ttlMs) return { hit: true, value: entry.value, stale: false };
    if (age < entry.ttlMs + entry.staleWindowMs) return { hit: true, value: entry.value, stale: true };
    store.delete(key);
    return { hit: false };
  }

  function set(key, value) {
    store.set(key, { value, type: "positive", setAt: nowFn(), ttlMs: positiveTtlMs, staleWindowMs });
  }

  function setNegative(key) {
    store.set(key, { type: "negative", setAt: nowFn(), ttlMs: negativeTtlMs });
  }

  return { get, set, setNegative };
}

const defaultCache = createCache();
module.exports = { createCache, defaultCache };
