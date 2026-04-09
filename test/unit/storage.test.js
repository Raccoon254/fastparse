import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStorage, urlToSubdir } from "../../src/storage/index.js";

async function makeTempDir() {
  return mkdtemp(path.join(tmpdir(), "fastparse-test-"));
}

test("createStorage with enabled=false is a no-op", async () => {
  const s = createStorage({ enabled: false });
  assert.equal(s.enabled, false);
  const result = await s.save({ url: "https://x.test/", json: { a: 1 }, markdown: "# x" });
  assert.equal(result, null);
});

test("createStorage with enabled=true writes both formats by default", async () => {
  const dir = await makeTempDir();
  try {
    const s = createStorage({ enabled: true, dir });
    const out = await s.save({
      url: "https://axene.io/about",
      json: { title: "About" },
      markdown: "# About\n\nhello",
    });
    assert.equal(out.written.length, 2);
    const files = await readdir(out.dir);
    assert.equal(files.length, 2);
    assert.ok(files.some((f) => f.endsWith(".json")));
    assert.ok(files.some((f) => f.endsWith(".markdown")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createStorage writes to {dir}/{host}/{path} structure", async () => {
  const dir = await makeTempDir();
  try {
    const s = createStorage({ enabled: true, dir });
    const out = await s.save({
      url: "https://axene.io/about/team",
      json: { x: 1 },
      markdown: "x",
    });
    const expected = path.join(dir, "axene.io", "about", "team");
    assert.equal(out.dir, expected);
    const files = await readdir(expected);
    assert.equal(files.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createStorage filename is an ISO timestamp with safe separators", async () => {
  const dir = await makeTempDir();
  try {
    const s = createStorage({ enabled: true, dir });
    const out = await s.save({
      url: "https://x.test/p",
      json: { ok: true },
      markdown: "ok",
    });
    for (const file of out.written) {
      const base = path.basename(file).replace(/\.(json|markdown)$/, "");
      assert.match(base, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createStorage saved JSON is valid and pretty-printed", async () => {
  const dir = await makeTempDir();
  try {
    const s = createStorage({ enabled: true, dir });
    const doc = { title: "T", url: "u", sections: [], metadata: {} };
    const out = await s.save({ url: "https://x.test/", json: doc, markdown: null });
    const jsonFile = out.written.find((f) => f.endsWith(".json"));
    const content = await readFile(jsonFile, "utf8");
    assert.deepEqual(JSON.parse(content), doc);
    assert.match(content, /\n  /); // pretty-printed
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createStorage with formats=['json'] only writes JSON", async () => {
  const dir = await makeTempDir();
  try {
    const s = createStorage({ enabled: true, dir, formats: ["json"] });
    const out = await s.save({
      url: "https://x.test/",
      json: { a: 1 },
      markdown: "should be skipped",
    });
    assert.equal(out.written.length, 1);
    assert.ok(out.written[0].endsWith(".json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createStorage with formats=['markdown'] only writes markdown", async () => {
  const dir = await makeTempDir();
  try {
    const s = createStorage({ enabled: true, dir, formats: ["markdown"] });
    const out = await s.save({
      url: "https://x.test/",
      json: { skipped: true },
      markdown: "# only this",
    });
    assert.equal(out.written.length, 1);
    assert.ok(out.written[0].endsWith(".markdown"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createStorage skips a format if its payload is missing", async () => {
  const dir = await makeTempDir();
  try {
    const s = createStorage({ enabled: true, dir });
    const out = await s.save({ url: "https://x.test/", json: null, markdown: "# only md" });
    assert.equal(out.written.length, 1);
    assert.ok(out.written[0].endsWith(".markdown"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createStorage propagates write errors", async () => {
  const s = createStorage({
    enabled: true,
    dir: "/tmp",
    mkdir: async () => {},
    writeFile: async () => {
      throw new Error("disk full");
    },
  });
  await assert.rejects(
    s.save({ url: "https://x.test/", json: { a: 1 } }),
    /disk full/,
  );
});

test("urlToSubdir handles root path", () => {
  assert.equal(urlToSubdir("https://example.com/"), "example.com");
});

test("urlToSubdir nests path segments", () => {
  assert.equal(
    urlToSubdir("https://axene.io/about/team"),
    path.join("axene.io", "about", "team"),
  );
});

test("urlToSubdir never produces .. segments", () => {
  // The URL parser already collapses ../.. before we see it, but explicit
  // dot segments embedded in encoded form should be neutralised too.
  const cases = [
    "https://x.test/../../etc/passwd",
    "https://x.test/%2E%2E/%2E%2E/etc/passwd",
    "https://x.test/foo/..%2Fbar",
  ];
  for (const c of cases) {
    const out = urlToSubdir(c);
    assert.doesNotMatch(out, /(^|\/)\.\.($|\/)/, `case: ${c} -> ${out}`);
    // Result must start with the host segment, never with /etc.
    assert.ok(out.startsWith("x.test"), `case: ${c} -> ${out}`);
  }
});

test("urlToSubdir replaces query-string and weird chars in segments", () => {
  const out = urlToSubdir("https://x.test/foo?bar=baz&qux=1");
  assert.doesNotMatch(out, /[?&=]/);
});

test("urlToSubdir falls back to _invalid for malformed urls", () => {
  assert.equal(urlToSubdir("not a url"), "_invalid");
});

test("urlToSubdir preserves the port in the host segment", () => {
  // colons get sanitized to underscores so the dir is shell-friendly.
  const out = urlToSubdir("http://127.0.0.1:8080/x");
  assert.match(out, /127\.0\.0\.1_8080/);
});

test("urlToSubdir falls back to _unknown when the URL has an empty host", () => {
  // file:// URLs have an empty host string.
  const out = urlToSubdir("file:///tmp/x");
  assert.match(out, /^_unknown/);
});
