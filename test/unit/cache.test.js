import { test } from "node:test";
import assert from "node:assert/strict";
import { createCache } from "../../src/cache/index.js";

test("cache get/set/has/delete", () => {
  const c = createCache();
  assert.equal(c.has("k"), false);
  assert.equal(c.get("k"), undefined);
  c.set("k", { v: 1 });
  assert.equal(c.has("k"), true);
  assert.deepEqual(c.get("k"), { v: 1 });
  assert.equal(c.size, 1);
  assert.equal(c.delete("k"), true);
  assert.equal(c.has("k"), false);
});

test("cache evicts beyond max", () => {
  const c = createCache({ max: 2 });
  c.set("a", 1);
  c.set("b", 2);
  c.set("c", 3);
  assert.equal(c.size, 2);
  assert.equal(c.has("a"), false);
  assert.equal(c.has("c"), true);
});

test("cache expires entries after ttlMs", async () => {
  const c = createCache({ ttlMs: 30 });
  c.set("k", "v");
  assert.equal(c.get("k"), "v");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(c.get("k"), undefined);
});

test("cache clear empties everything", () => {
  const c = createCache();
  c.set("a", 1);
  c.set("b", 2);
  c.clear();
  assert.equal(c.size, 0);
});

test("cache.set returns the stored value", () => {
  const c = createCache();
  const v = { hello: "world" };
  assert.equal(c.set("k", v), v);
});
