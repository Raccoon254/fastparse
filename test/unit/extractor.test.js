import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createExtractor,
  extract,
  ExtractError,
  _resetDefaultExtractor,
} from "../../src/extract.js";
import { FetchError } from "../../src/fetch/index.js";

const richHtml = `<html><body><article>
  <h1>Title</h1>
  <h2>Intro</h2>
  <p>${"first paragraph with words and commas, more text. ".repeat(20)}</p>
  <h2>Details</h2>
  <p>${"second paragraph with words and commas, more text. ".repeat(15)}</p>
</article></body></html>`;

function makeStub(opts = {}) {
  return {
    isThinContent: () => false,
    fetchHtml: async () => ({
      html: opts.html ?? richHtml,
      finalUrl: opts.url ?? "http://x.test/",
      status: 200,
      contentType: "text/html",
    }),
    ...opts.deps,
  };
}

test("extract throws ExtractError(invalid-url) for missing url", async () => {
  const e = createExtractor(makeStub());
  await assert.rejects(
    () => e.extract(),
    (err) => err instanceof ExtractError && err.code === "invalid-url",
  );
});

test("extract throws ExtractError(invalid-url) for non-string url", async () => {
  const e = createExtractor(makeStub());
  await assert.rejects(
    () => e.extract(123),
    (err) => err.code === "invalid-url",
  );
});

test("extract throws ExtractError(invalid-url) for unparseable url", async () => {
  const e = createExtractor(makeStub());
  await assert.rejects(
    () => e.extract("not-a-url"),
    (err) => err.code === "invalid-url",
  );
});

test("extract throws ExtractError(invalid-url) for non-http schemes", async () => {
  const e = createExtractor(makeStub());
  await assert.rejects(
    () => e.extract("ftp://example.com"),
    (err) => err.code === "invalid-url",
  );
});

test("extract throws ExtractError(invalid-format) for unknown format", async () => {
  const e = createExtractor(makeStub());
  await assert.rejects(
    () => e.extract("http://x.test/", { format: "xml" }),
    (err) => err.code === "invalid-format",
  );
});

test("extract throws ExtractError(invalid-mode) for unknown mode", async () => {
  const e = createExtractor(makeStub());
  await assert.rejects(
    () => e.extract("http://x.test/", { mode: "bogus" }),
    (err) => err.code === "invalid-mode",
  );
});

test("extract throws ExtractError(invalid-max) for non-positive maxSections", async () => {
  const e = createExtractor(makeStub());
  for (const v of [0, -1, 1.5, "abc"]) {
    await assert.rejects(
      () => e.extract("http://x.test/", { maxSections: v }),
      (err) => err.code === "invalid-max",
      `value=${v}`,
    );
  }
});

test("extract returns json document with cacheStatus", async () => {
  const e = createExtractor(makeStub());
  const out = await e.extract("http://x.test/");
  assert.equal(out.title, "Title");
  assert.equal(out.metadata.format, "json");
  assert.equal(out.cacheStatus, "miss");
  assert.ok(Array.isArray(out.sections));
});

test("extract returns markdown when format=markdown", async () => {
  const e = createExtractor(makeStub());
  const out = await e.extract("http://x.test/", { format: "markdown" });
  assert.equal(out.metadata.format, "markdown");
  assert.equal(typeof out.content, "string");
  assert.match(out.content, /# Title/);
});

test("extract serves second call from cache", async () => {
  let calls = 0;
  const e = createExtractor(
    makeStub({
      deps: {
        fetchHtml: async () => {
          calls++;
          return {
            html: richHtml,
            finalUrl: "http://x.test/",
            status: 200,
            contentType: "text/html",
          };
        },
      },
    }),
  );
  const a = await e.extract("http://x.test/");
  const b = await e.extract("http://x.test/");
  assert.equal(a.cacheStatus, "miss");
  assert.equal(b.cacheStatus, "hit");
  assert.equal(calls, 1);
});

test("extract bypasses cache when fresh=true", async () => {
  let calls = 0;
  const e = createExtractor(
    makeStub({
      deps: {
        fetchHtml: async () => {
          calls++;
          return {
            html: richHtml,
            finalUrl: "http://x.test/",
            status: 200,
            contentType: "text/html",
          };
        },
      },
    }),
  );
  await e.extract("http://x.test/");
  await e.extract("http://x.test/", { fresh: true });
  assert.equal(calls, 2);
});

test("extract maps FetchError to ExtractError(fetch-failed)", async () => {
  const e = createExtractor({
    fetchHtml: async () => {
      throw new FetchError("HTTP 404", { url: "http://x.test/", status: 404 });
    },
    isThinContent: () => false,
  });
  await assert.rejects(
    () => e.extract("http://x.test/"),
    (err) => {
      assert.ok(err instanceof ExtractError);
      assert.equal(err.code, "fetch-failed");
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test("extract re-throws non-FetchError errors from fetchHtml", async () => {
  const e = createExtractor({
    fetchHtml: async () => {
      throw new Error("kaboom");
    },
    isThinContent: () => false,
  });
  await assert.rejects(
    () => e.extract("http://x.test/"),
    /kaboom/,
  );
});

test("extract throws ExtractError(no-content) when findMainContent returns null", async () => {
  const e = createExtractor({
    isThinContent: () => false,
    fetchHtml: async () => ({
      html: "<html><body>x</body></html>",
      finalUrl: "http://x.test/",
      status: 200,
      contentType: "text/html",
    }),
    findMainContent: () => null,
  });
  await assert.rejects(
    () => e.extract("http://x.test/"),
    (err) => err instanceof ExtractError && err.code === "no-content",
  );
});

test("extract calls renderer when content is thin", async () => {
  let renderCalls = 0;
  const e = createExtractor({
    fetchHtml: async () => ({
      html: '<html><body><div id="root"></div></body></html>',
      finalUrl: "http://spa.test/",
      status: 200,
      contentType: "text/html",
    }),
    renderer: {
      render: async () => {
        renderCalls++;
        return {
          html: richHtml,
          finalUrl: "http://spa.test/",
          status: 200,
          contentType: "text/html",
          rendered: true,
        };
      },
      close: async () => {},
    },
  });
  const out = await e.extract("http://spa.test/");
  assert.equal(renderCalls, 1);
  assert.equal(out.metadata.rendered, true);
});

test("extract logs and continues when renderer fails on thin content", async () => {
  const warnings = [];
  const e = createExtractor({
    fetchHtml: async () => ({
      html: '<html><body><div id="root"></div></body></html>',
      finalUrl: "http://spa.test/",
      status: 200,
      contentType: "text/html",
    }),
    renderer: {
      render: async () => {
        throw new Error("playwright missing");
      },
    },
    logger: { warn: (...a) => warnings.push(a), error() {} },
  });
  // Should not throw — falls back to whatever the original fetch returned.
  // The body is too thin to extract anything useful, so findMainContent
  // returns body and we get a degraded but valid response.
  const out = await e.extract("http://spa.test/").catch((e) => e);
  assert.ok(warnings.length >= 1);
  // Either an empty doc or a no-content error is acceptable.
  assert.ok(
    out instanceof ExtractError || out.title !== undefined,
  );
});

test("extract uses the default NOOP logger when no logger is injected", async () => {
  // No logger override → fallback to NOOP_LOGGER. Trigger a renderer
  // failure so logger.warn is actually called.
  const e = createExtractor({
    fetchHtml: async () => ({
      html: '<html><body><div id="root"></div></body></html>',
      finalUrl: "http://spa.test/",
      status: 200,
      contentType: "text/html",
    }),
    renderer: {
      render: async () => {
        throw new Error("playwright missing");
      },
    },
  });
  await e.extract("http://spa.test/").catch(() => {});
});

test("extract triggers storage.save on cache miss", async () => {
  const calls = [];
  const e = createExtractor(
    makeStub({
      deps: {
        storage: {
          enabled: true,
          dir: "/tmp",
          formats: ["json", "markdown"],
          async save(args) {
            calls.push(args);
          },
        },
      },
    }),
  );
  await e.extract("http://x.test/");
  // fire-and-forget — let it land
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0].markdown, "string");
});

test("extract logs and swallows storage.save failures", async () => {
  const warnings = [];
  const e = createExtractor(
    makeStub({
      deps: {
        storage: {
          enabled: true,
          async save() {
            throw new Error("disk full");
          },
        },
        logger: { warn: (...a) => warnings.push(a), error() {} },
      },
    }),
  );
  const out = await e.extract("http://x.test/");
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(out.title, "Title", "extract should still succeed");
  assert.ok(warnings.some((w) => /storage save failed/.test(w[1])));
});

test("extract metadata.mode reflects optimizer mode", async () => {
  const e = createExtractor(makeStub());
  const full = await e.extract("http://x.test/");
  const summary = await e.extract("http://x.test/", { mode: "summary", maxSections: 1 });
  assert.equal(full.metadata.mode, "full");
  assert.equal(summary.metadata.mode, "summary");
});

test("default extract() singleton works for one-shot use", async () => {
  _resetDefaultExtractor();
  // Drive the singleton through a stub by replacing it via the test hook.
  // We can't inject into the singleton, so we just verify the convenience
  // function delegates and surfaces ExtractError correctly.
  await assert.rejects(
    () => extract("not a url"),
    (err) => err instanceof ExtractError && err.code === "invalid-url",
  );
});
