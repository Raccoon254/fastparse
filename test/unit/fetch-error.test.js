import { test } from "node:test";
import assert from "node:assert/strict";
import { FetchError } from "../../src/fetch/index.js";

test("FetchError defaults", () => {
  const err = new FetchError("boom");
  assert.equal(err.name, "FetchError");
  assert.equal(err.message, "boom");
  assert.equal(err.url, undefined);
  assert.equal(err.status, undefined);
  assert.equal(err.cause, undefined);
});

test("FetchError carries url, status, and cause", () => {
  const cause = new Error("inner");
  const err = new FetchError("outer", {
    url: "https://x.test/",
    status: 502,
    cause,
  });
  assert.equal(err.url, "https://x.test/");
  assert.equal(err.status, 502);
  assert.equal(err.cause, cause);
});
