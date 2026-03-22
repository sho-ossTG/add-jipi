const DEFAULT_PROVIDER_CAP = Number(process.env.PROVIDER_CONCURRENCY_LIMIT) || 3;
const DEFAULT_GLOBAL_CAP = Number(process.env.GLOBAL_CONCURRENCY_LIMIT) || 10;

function createConcurrencyGuard(options = {}) {
  const providerLimit = Number(options.providerConcurrencyLimit) || DEFAULT_PROVIDER_CAP;
  const globalLimit = Number(options.globalConcurrencyLimit) || DEFAULT_GLOBAL_CAP;

  const inflight = new Map();
  let globalCount = 0;
  let providerCount = 0;

  async function execute(key, operation) {
    // 1. Global cap — fastest rejection path
    if (globalCount >= globalLimit) {
      const err = new Error("Global concurrency limit reached");
      err.code = "capacity_busy";
      throw err;
    }

    // 2. Singleflight — join existing in-flight for same key (BEFORE provider cap)
    if (inflight.has(key)) {
      return inflight.get(key);
    }

    // 3. Per-provider cap
    if (providerCount >= providerLimit) {
      const err = new Error("Provider concurrency limit reached");
      err.code = "capacity_busy";
      throw err;
    }

    // 4. Register and execute
    globalCount += 1;
    providerCount += 1;

    const promise = Promise.resolve(operation()).finally(() => {
      globalCount -= 1;
      providerCount -= 1;
      inflight.delete(key);
    });

    inflight.set(key, promise);
    return promise;
  }

  function stats() {
    return { inflightKeys: inflight.size, globalCount, providerCount };
  }

  return { execute, stats };
}

// resolveFirstN: returns first topN valid results without waiting for stragglers.
// With 1 provider (current state), collapses to a simple resolve/reject.
// With N providers (future), returns fastest valid results.
function resolveFirstN(providerFns, { topN = 1 } = {}) {
  return new Promise((resolve, reject) => {
    const valid = [];
    let failCount = 0;
    const total = providerFns.length;

    if (total === 0) {
      reject(new Error("No providers"));
      return;
    }

    providerFns.forEach((fn) => {
      Promise.resolve().then(() => fn()).then(
        (result) => {
          if (valid.length < topN) {
            valid.push(result);
            if (valid.length >= topN) resolve(valid.slice(0, topN));
          }
        },
        () => {
          failCount += 1;
          if (failCount === total && valid.length === 0) {
            reject(new Error("All providers failed"));
          } else if (failCount === total && valid.length > 0) {
            resolve(valid.slice(0, valid.length));
          }
        }
      );
    });
  });
}

module.exports = { createConcurrencyGuard, resolveFirstN };
