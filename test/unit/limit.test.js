import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter } from "../../src/limit/index.js";

// Tiny deferred utility — a promise that resolves on demand.
function defer() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Yield to the microtask queue so any chained `.then` blocks can run.
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

// Fake clock + timer registry. Calling tick(ms) advances the clock and
// fires any callbacks whose due time has been reached.
function fakeClock() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    schedule: (fn, ms) => {
      timers.push({ at: t + ms, fn });
      timers.sort((a, b) => a.at - b.at);
    },
    async tick(ms) {
      const target = t + ms;
      while (timers.length && timers[0].at <= target) {
        const next = timers.shift();
        t = next.at;
        next.fn();
        await flush();
      }
      t = target;
      await flush();
    },
  };
}

test("createLimiter caps concurrency per host", async () => {
  const limiter = createLimiter({ perHostConcurrency: 2, perHostRps: 1000 });
  let active = 0;
  let peak = 0;
  const gates = Array.from({ length: 5 }, () => defer());

  const tasks = gates.map((g, i) =>
    limiter.run("h", async () => {
      active++;
      peak = Math.max(peak, active);
      await g.promise;
      active--;
      return i;
    }),
  );

  await flush();
  assert.equal(active, 2, "only 2 tasks should be active under cap");
  assert.equal(limiter.stats("h").queued, 3);

  // Release one — the next queued task should start.
  gates[0].resolve();
  await flush();
  assert.equal(active, 2);
  assert.equal(limiter.stats("h").queued, 2);

  // Release the rest.
  for (let i = 1; i < 5; i++) gates[i].resolve();
  const results = await Promise.all(tasks);
  assert.deepEqual(results, [0, 1, 2, 3, 4]);
  assert.equal(peak, 2);
});

test("createLimiter is independent per host", async () => {
  const limiter = createLimiter({ perHostConcurrency: 1, perHostRps: 1000 });
  const aGate = defer();
  const bGate = defer();
  let aRunning = false;
  let bRunning = false;

  const a = limiter.run("a", async () => {
    aRunning = true;
    await aGate.promise;
    return "a";
  });
  const b = limiter.run("b", async () => {
    bRunning = true;
    await bGate.promise;
    return "b";
  });

  await flush();
  assert.equal(aRunning, true);
  assert.equal(bRunning, true, "different hosts should not block each other");

  aGate.resolve();
  bGate.resolve();
  assert.deepEqual(await Promise.all([a, b]), ["a", "b"]);
});

test("createLimiter rate-limits with token bucket and fake clock", async () => {
  const clock = fakeClock();
  const limiter = createLimiter({
    perHostConcurrency: 10,
    perHostRps: 2,
    now: clock.now,
    schedule: clock.schedule,
  });

  const order = [];
  const tasks = [];
  for (let i = 0; i < 5; i++) {
    tasks.push(
      limiter.run("h", async () => {
        order.push(i);
        return i;
      }),
    );
  }

  // First burst: 2 tokens available, so the first 2 tasks run immediately.
  await flush();
  assert.deepEqual(order, [0, 1]);

  // Tick 500ms — refills 1 token (rps=2 → 1 token / 500ms).
  await clock.tick(600);
  assert.deepEqual(order, [0, 1, 2]);

  // Another 500ms → next token.
  await clock.tick(500);
  assert.deepEqual(order, [0, 1, 2, 3]);

  // Another 500ms → last token.
  await clock.tick(500);
  assert.deepEqual(order, [0, 1, 2, 3, 4]);

  await Promise.all(tasks);
});

test("createLimiter releases the slot when the task throws", async () => {
  const limiter = createLimiter({ perHostConcurrency: 1, perHostRps: 1000 });
  await assert.rejects(
    limiter.run("h", async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  // Slot should be free again.
  const result = await limiter.run("h", async () => "ok");
  assert.equal(result, "ok");
  assert.equal(limiter.stats("h").active, 0);
});

test("createLimiter propagates synchronous throws as rejections", async () => {
  const limiter = createLimiter({ perHostConcurrency: 1, perHostRps: 1000 });
  await assert.rejects(
    limiter.run("h", () => {
      throw new Error("sync boom");
    }),
    /sync boom/,
  );
  // Still usable.
  assert.equal(await limiter.run("h", async () => 7), 7);
});

test("createLimiter preserves FIFO order under contention", async () => {
  const limiter = createLimiter({ perHostConcurrency: 1, perHostRps: 1000 });
  const order = [];
  const gate = defer();
  // First task holds the slot.
  const first = limiter.run("h", async () => {
    order.push("first");
    await gate.promise;
  });
  // Subsequent tasks queue.
  const rest = [2, 3, 4, 5].map((n) =>
    limiter.run("h", async () => {
      order.push(n);
      return n;
    }),
  );

  await flush();
  assert.deepEqual(order, ["first"]);
  gate.resolve();
  await Promise.all([first, ...rest]);
  assert.deepEqual(order, ["first", 2, 3, 4, 5]);
});

test("createLimiter.size tracks distinct hosts", async () => {
  const limiter = createLimiter({ perHostConcurrency: 5, perHostRps: 1000 });
  assert.equal(limiter.size, 0);
  await limiter.run("a", async () => {});
  await limiter.run("b", async () => {});
  await limiter.run("a", async () => {});
  assert.equal(limiter.size, 2);
});

test("createLimiter.stats returns null for unknown host", () => {
  const limiter = createLimiter();
  assert.equal(limiter.stats("never-seen"), null);
});

test("createLimiter uses real timers and Date.now() by default", async () => {
  // Quick smoke check that the production defaults wire up correctly.
  const limiter = createLimiter({ perHostConcurrency: 1, perHostRps: 100 });
  const result = await limiter.run("h", async () => 42);
  assert.equal(result, 42);
});

test("createLimiter default schedule actually defers via setTimeout when bucket empties", async () => {
  // rps=10 → 10 tokens at start. Submitting 12 tasks forces the 11th and
  // 12th to wait for the default setTimeout-backed scheduler.
  const limiter = createLimiter({ perHostConcurrency: 20, perHostRps: 10 });
  const start = Date.now();
  await Promise.all(
    Array.from({ length: 12 }, (_, i) => limiter.run("h", async () => i)),
  );
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 50, `expected real delay, got ${elapsed}ms`);
});
