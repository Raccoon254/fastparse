// src/limit/index.js
//
// Per-host concurrency limit + token-bucket rate limit.
//
// Each remote host gets its own queue. A submitted task must:
//   1. Acquire a token from the host's bucket (rate limit), and
//   2. Acquire one of N concurrency slots,
// before its function is invoked. Tasks beyond those caps are queued in
// FIFO order. Tasks on different hosts never block each other.
//
// The clock and the timer are injectable so tests can drive the limiter
// deterministically without sleeping.

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_RPS = 4;

class HostLimiter {
  constructor({ concurrency, rps, now, schedule }) {
    this.concurrency = concurrency;
    this.rps = rps;
    this.now = now;
    this.schedule = schedule;

    this.active = 0;
    this.queue = [];
    this.tokens = rps; // start full so the first burst goes through
    this.lastRefill = now();
    this.timerPending = false;
  }

  #refill() {
    const t = this.now();
    const elapsedSec = (t - this.lastRefill) / 1000;
    if (elapsedSec > 0) {
      this.tokens = Math.min(this.rps, this.tokens + elapsedSec * this.rps);
      this.lastRefill = t;
    }
  }

  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.#drain();
    });
  }

  #drain() {
    while (this.queue.length > 0 && this.active < this.concurrency) {
      this.#refill();
      if (this.tokens < 1) {
        if (!this.timerPending) {
          const deficit = 1 - this.tokens;
          const waitMs = Math.ceil((deficit / this.rps) * 1000) + 1;
          this.timerPending = true;
          this.schedule(() => {
            this.timerPending = false;
            this.#drain();
          }, waitMs);
        }
        return;
      }

      this.tokens -= 1;
      this.active += 1;
      const item = this.queue.shift();

      // Defer execution to a microtask so synchronous throws inside fn()
      // are surfaced through the returned promise consistently.
      Promise.resolve()
        .then(() => item.fn())
        .then(
          (value) => {
            this.active -= 1;
            item.resolve(value);
            this.#drain();
          },
          (err) => {
            this.active -= 1;
            item.reject(err);
            this.#drain();
          },
        );
    }
  }
}

/**
 * Build a limiter that fans tasks out across per-host queues.
 *
 * @param {object} [opts]
 * @param {number} [opts.perHostConcurrency=4]
 * @param {number} [opts.perHostRps=4]
 * @param {() => number} [opts.now]            injectable clock for tests
 * @param {(fn: () => void, ms: number) => void} [opts.schedule]  injectable timer
 */
export function createLimiter({
  perHostConcurrency = DEFAULT_CONCURRENCY,
  perHostRps = DEFAULT_RPS,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  const hosts = new Map();

  function getHost(host) {
    let l = hosts.get(host);
    if (!l) {
      l = new HostLimiter({
        concurrency: perHostConcurrency,
        rps: perHostRps,
        now,
        schedule,
      });
      hosts.set(host, l);
    }
    return l;
  }

  return {
    /**
     * Queue a function for execution under the given host's limits.
     * Resolves with the function's return value (or rejects with its error).
     */
    run(host, fn) {
      return getHost(host).enqueue(fn);
    },

    /** Number of hosts currently tracked. */
    get size() {
      return hosts.size;
    },

    /**
     * Inspection helpers, mostly for tests and observability.
     */
    stats(host) {
      const l = hosts.get(host);
      if (!l) return null;
      return {
        active: l.active,
        queued: l.queue.length,
        tokens: l.tokens,
      };
    },
  };
}
