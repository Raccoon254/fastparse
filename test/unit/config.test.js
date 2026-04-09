import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, DEFAULTS } from "../../src/config/index.js";

test("loadConfig returns the defaults when nothing overrides them", () => {
  const c = loadConfig({ env: {} });
  assert.deepEqual(c.server, DEFAULTS.server);
  assert.deepEqual(c.storage, DEFAULTS.storage);
  assert.deepEqual(c.cache, DEFAULTS.cache);
  assert.deepEqual(c.limit, DEFAULTS.limit);
});

test("loadConfig is non-mutating across calls", () => {
  const a = loadConfig({ env: {} });
  a.storage.dir = "/tmp/x";
  const b = loadConfig({ env: {} });
  assert.notEqual(b.storage.dir, "/tmp/x");
});

test("loadConfig reads FASTPARSE_STORAGE_* env vars", () => {
  const c = loadConfig({
    env: {
      FASTPARSE_STORAGE_ENABLED: "false",
      FASTPARSE_STORAGE_DIR: "/var/data",
      FASTPARSE_STORAGE_FORMATS: "json",
    },
  });
  assert.equal(c.storage.enabled, false);
  assert.equal(c.storage.dir, "/var/data");
  assert.deepEqual(c.storage.formats, ["json"]);
});

test("loadConfig parses comma-separated formats with whitespace", () => {
  const c = loadConfig({
    env: { FASTPARSE_STORAGE_FORMATS: " json , markdown " },
  });
  assert.deepEqual(c.storage.formats, ["json", "markdown"]);
});

test("loadConfig FASTPARSE_STORAGE_ENABLED only enables on literal 'true'", () => {
  for (const v of ["true", "false", "yes", "1", "0", ""]) {
    const c = loadConfig({ env: { FASTPARSE_STORAGE_ENABLED: v } });
    assert.equal(c.storage.enabled, v === "true", `value=${v}`);
  }
});

test("loadConfig reads server host/port", () => {
  const c = loadConfig({
    env: { FASTPARSE_HOST: "0.0.0.0", FASTPARSE_PORT: "8080" },
  });
  assert.equal(c.server.host, "0.0.0.0");
  assert.equal(c.server.port, 8080);
});

test("loadConfig ignores invalid integer env vars", () => {
  const c = loadConfig({
    env: {
      FASTPARSE_PORT: "abc",
      FASTPARSE_CACHE_MAX: "-1",
      FASTPARSE_CACHE_TTL_MS: "0",
      FASTPARSE_LIMIT_CONCURRENCY: "not-a-number",
      FASTPARSE_LIMIT_RPS: "1.5",
    },
  });
  assert.equal(c.server.port, DEFAULTS.server.port);
  assert.equal(c.cache.max, DEFAULTS.cache.max);
  assert.equal(c.cache.ttlMs, DEFAULTS.cache.ttlMs);
  assert.equal(c.limit.perHostConcurrency, DEFAULTS.limit.perHostConcurrency);
  assert.equal(c.limit.perHostRps, DEFAULTS.limit.perHostRps);
});

test("loadConfig accepts valid integer env vars", () => {
  const c = loadConfig({
    env: {
      FASTPARSE_CACHE_MAX: "100",
      FASTPARSE_CACHE_TTL_MS: "60000",
      FASTPARSE_LIMIT_CONCURRENCY: "8",
      FASTPARSE_LIMIT_RPS: "10",
    },
  });
  assert.equal(c.cache.max, 100);
  assert.equal(c.cache.ttlMs, 60000);
  assert.equal(c.limit.perHostConcurrency, 8);
  assert.equal(c.limit.perHostRps, 10);
});

test("loadConfig overrides win over env vars", () => {
  const c = loadConfig({
    env: { FASTPARSE_STORAGE_DIR: "/from/env" },
    overrides: { storage: { dir: "/from/code", enabled: false } },
  });
  assert.equal(c.storage.dir, "/from/code");
  assert.equal(c.storage.enabled, false);
  // Untouched fields are preserved.
  assert.deepEqual(c.storage.formats, DEFAULTS.storage.formats);
});

test("loadConfig deep-merges nested overrides", () => {
  const c = loadConfig({
    env: {},
    overrides: {
      cache: { max: 9 },
      limit: { perHostRps: 99 },
    },
  });
  assert.equal(c.cache.max, 9);
  assert.equal(c.cache.ttlMs, DEFAULTS.cache.ttlMs);
  assert.equal(c.limit.perHostRps, 99);
  assert.equal(c.limit.perHostConcurrency, DEFAULTS.limit.perHostConcurrency);
});

test("loadConfig accepts arrays in overrides without merging into them", () => {
  const c = loadConfig({
    env: {},
    overrides: { storage: { formats: ["markdown"] } },
  });
  assert.deepEqual(c.storage.formats, ["markdown"]);
});

test("loadConfig overrides can introduce brand-new top-level keys", () => {
  const c = loadConfig({
    env: {},
    overrides: { custom: { foo: { bar: 1 } } },
  });
  assert.deepEqual(c.custom, { foo: { bar: 1 } });
});
