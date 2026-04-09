import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { buildServer } from "../../src/api/server.js";
import { createCache } from "../../src/cache/index.js";

let upstream;
let upstreamUrl;
let app;

const FIXTURE = `
  <!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8">
    <meta property="og:title" content="API Test Page">
    <title>fallback title</title>
  </head>
  <body>
    <nav>NAV_NOISE</nav>
    <header>HEADER_NOISE</header>
    <article>
      <h1>API Test Page</h1>
      <h2>Intro</h2>
      <p>Intro paragraph one with several commas, words, and prose-like content. It has enough text to win the scoring contest.</p>
      <p>Intro paragraph two, also with commas and words, makes sure the section has substance.</p>
      <h2>Details</h2>
      <p>Details paragraph one, plenty of words and punctuation, prose-shaped sentences here.</p>
    </article>
    <aside>ASIDE_NOISE</aside>
    <footer>FOOTER_NOISE</footer>
  </body>
  </html>
`;

before(async () => {
  upstream = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(FIXTURE);
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const { port } = upstream.address();
  upstreamUrl = `http://127.0.0.1:${port}/`;

  app = buildServer({
    logger: false,
    deps: {
      cache: createCache(),
      // Disable the renderer in the default test app so we don't try to
      // launch a real browser; tests that exercise the renderer inject
      // their own.
      renderer: { render: async () => { throw new Error("renderer disabled"); }, close: async () => {} },
    },
  });
  await app.ready();
});

after(async () => {
  await app.close();
  await new Promise((r) => upstream.close(r));
});

test("GET /health returns ok", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
});

test("GET /extract returns structured document", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/extract?url=${encodeURIComponent(upstreamUrl)}`,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();

  assert.equal(body.title, "API Test Page");
  assert.ok(Array.isArray(body.sections));
  const headings = body.sections.map((s) => s.heading);
  assert.ok(headings.includes("Intro"), `headings=${headings.join(",")}`);
  assert.ok(headings.includes("Details"), `headings=${headings.join(",")}`);

  const allText = body.sections.map((s) => s.content).join(" ");
  for (const noise of ["NAV_NOISE", "HEADER_NOISE", "ASIDE_NOISE", "FOOTER_NOISE"]) {
    assert.ok(!allText.includes(noise), `${noise} leaked into output`);
  }

  assert.equal(typeof body.metadata.word_count, "number");
  assert.ok(body.metadata.word_count > 20);
  assert.equal(body.metadata.section_count, body.sections.length);
});

test("GET /extract rejects missing url with 400", async () => {
  const res = await app.inject({ method: "GET", url: "/extract" });
  assert.equal(res.statusCode, 400);
});

test("GET /extract rejects malformed url with 400", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/extract?url=not-a-url",
  });
  assert.equal(res.statusCode, 400);
});

test("GET /extract rejects non-http schemes with 400", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/extract?url=ftp://example.com",
  });
  assert.equal(res.statusCode, 400);
});

test("GET /extract returns 502 when upstream is unreachable", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/extract?url=http://127.0.0.1:1/nope",
  });
  assert.equal(res.statusCode, 502);
});

test("GET /extract returns 422 when no content can be extracted", async () => {
  const noContentApp = buildServer({
    logger: false,
    deps: {
      fetchHtml: async () => ({
        // Big enough that isThinContent returns false → renderer is not invoked.
        html: "<html><body>" + "x".repeat(600) + "</body></html>",
        finalUrl: "http://x.test/",
        status: 200,
        contentType: "text/html",
      }),
      findMainContent: () => null,
    },
  });
  await noContentApp.ready();
  const res = await noContentApp.inject({
    method: "GET",
    url: "/extract?url=http://x.test/",
  });
  assert.equal(res.statusCode, 422);
  assert.match(res.json().error, /no extractable content/);
  await noContentApp.close();
});

test("GET /extract returns 500 on unexpected internal errors", async () => {
  const brokenApp = buildServer({
    logger: false,
    deps: {
      fetchHtml: async () => ({
        html: "<html><body>" + "x".repeat(600) + "</body></html>",
        finalUrl: "http://x.test/",
        status: 200,
        contentType: "text/html",
      }),
      parseHtml: () => {
        throw new Error("kaboom");
      },
    },
  });
  await brokenApp.ready();
  const res = await brokenApp.inject({
    method: "GET",
    url: "/extract?url=http://x.test/",
  });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error, "internal error");
  await brokenApp.close();
});

test("GET /extract serves second hit from cache", async () => {
  let calls = 0;
  const cachedApp = buildServer({
    logger: false,
    deps: {
      fetchHtml: async () => {
        calls++;
        return {
          html: `<html><body><article>${"<p>hello world with enough commas, words, and text. </p>".repeat(20)}</article></body></html>`,
          finalUrl: "http://cached.test/",
          status: 200,
          contentType: "text/html",
        };
      },
    },
  });
  await cachedApp.ready();

  const r1 = await cachedApp.inject({ method: "GET", url: "/extract?url=http://cached.test/" });
  const r2 = await cachedApp.inject({ method: "GET", url: "/extract?url=http://cached.test/" });

  assert.equal(r1.statusCode, 200);
  assert.equal(r2.statusCode, 200);
  assert.equal(r1.headers["x-fastparse-cache"], "miss");
  assert.equal(r2.headers["x-fastparse-cache"], "hit");
  assert.equal(calls, 1, "fetchHtml should only run once");
  assert.deepEqual(r2.json(), r1.json());

  // ?fresh=1 should bypass the cache.
  const r3 = await cachedApp.inject({ method: "GET", url: "/extract?url=http://cached.test/&fresh=1" });
  assert.equal(r3.headers["x-fastparse-cache"], "miss");
  assert.equal(calls, 2);

  // ?fresh=true should also bypass the cache.
  const r4 = await cachedApp.inject({ method: "GET", url: "/extract?url=http://cached.test/&fresh=true" });
  assert.equal(r4.headers["x-fastparse-cache"], "miss");
  assert.equal(calls, 3);

  await cachedApp.close();
});

test("GET /extract uses renderer when fetched HTML is thin", async () => {
  let renderedCalls = 0;
  const renderedApp = buildServer({
    logger: false,
    deps: {
      fetchHtml: async () => ({
        html: `<html><body><div id="root"></div></body></html>`,
        finalUrl: "http://spa.test/",
        status: 200,
        contentType: "text/html",
      }),
      renderer: {
        render: async () => {
          renderedCalls++;
          return {
            html: `<html><body><article><h1>SPA</h1>${"<p>rendered prose with words, commas, and text. </p>".repeat(20)}</article></body></html>`,
            finalUrl: "http://spa.test/",
            status: 200,
            contentType: "text/html",
            rendered: true,
          };
        },
        close: async () => {},
      },
    },
  });
  await renderedApp.ready();

  const res = await renderedApp.inject({ method: "GET", url: "/extract?url=http://spa.test/" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(renderedCalls, 1);
  assert.equal(body.metadata.rendered, true);
  assert.match(JSON.stringify(body.sections), /rendered prose/);

  await renderedApp.close();
});

test("GET /extract supports ?mode=summary", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/extract?url=${encodeURIComponent(upstreamUrl)}&mode=summary&max=1`,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.metadata.mode, "summary");
  assert.equal(body.sections.length, 1);
});

test("GET /extract returns full mode when no ?mode is given", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/extract?url=${encodeURIComponent(upstreamUrl)}`,
  });
  assert.equal(res.json().metadata.mode, "full");
});

test("GET /extract reuses cached raw doc across modes", async () => {
  let calls = 0;
  const cachedApp = buildServer({
    logger: false,
    deps: {
      // Disable the thin-content detector so this test never tries to launch
      // a real browser; we're testing the cache, not the renderer.
      isThinContent: () => false,
      fetchHtml: async () => {
        calls++;
        return {
          html: `<html><body><article>
            <h2>One</h2><p>${"alpha alpha alpha alpha alpha, ".repeat(20)}</p>
            <h2>Two</h2><p>${"bravo bravo bravo bravo bravo, ".repeat(40)}</p>
            <h2>Three</h2><p>${"charlie charlie charlie, ".repeat(15)}</p>
          </article></body></html>`,
          finalUrl: "http://multi-mode.test/",
          status: 200,
          contentType: "text/html",
        };
      },
    },
  });
  await cachedApp.ready();

  const r1 = await cachedApp.inject({ method: "GET", url: "/extract?url=http://multi-mode.test/" });
  const r2 = await cachedApp.inject({ method: "GET", url: "/extract?url=http://multi-mode.test/&mode=summary&max=1" });
  const r3 = await cachedApp.inject({ method: "GET", url: "/extract?url=http://multi-mode.test/" });

  assert.equal(r1.headers["x-fastparse-cache"], "miss");
  assert.equal(r2.headers["x-fastparse-cache"], "hit");
  assert.equal(r3.headers["x-fastparse-cache"], "hit");
  assert.equal(calls, 1, "fetch should run once across all three calls");

  assert.equal(r1.json().metadata.mode, "full");
  assert.equal(r2.json().metadata.mode, "summary");
  assert.equal(r2.json().sections.length, 1);
  assert.equal(r3.json().metadata.mode, "full");

  await cachedApp.close();
});

test("GET /extract rejects unknown ?mode with 400", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/extract?url=${encodeURIComponent(upstreamUrl)}&mode=bogus`,
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /unknown mode/);
});

test("GET /extract accepts mode=full explicitly", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/extract?url=${encodeURIComponent(upstreamUrl)}&mode=full`,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().metadata.mode, "full");
});

test("GET /extract rejects non-integer ?max with 400", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/extract?url=${encodeURIComponent(upstreamUrl)}&max=abc`,
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /max must be a positive integer/);
});

test("GET /extract rejects zero or negative ?max with 400", async () => {
  for (const v of ["0", "-3"]) {
    const res = await app.inject({
      method: "GET",
      url: `/extract?url=${encodeURIComponent(upstreamUrl)}&max=${v}`,
    });
    assert.equal(res.statusCode, 400, `max=${v}`);
  }
});

test("GET /extract returns markdown when ?format=markdown", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/extract?url=${encodeURIComponent(upstreamUrl)}&format=markdown`,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.metadata.format, "markdown");
  assert.equal(typeof body.content, "string");
  assert.match(body.content, /# API Test Page|## Intro/);
  assert.match(body.content, /## Intro/);
  assert.match(body.content, /## Details/);
  assert.ok(body.metadata.word_count > 10);
});

test("GET /extract markdown response strips noise", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/extract?url=${encodeURIComponent(upstreamUrl)}&format=markdown`,
  });
  const md = res.json().content;
  for (const noise of ["NAV_NOISE", "HEADER_NOISE", "ASIDE_NOISE", "FOOTER_NOISE"]) {
    assert.doesNotMatch(md, new RegExp(noise));
  }
});

test("GET /extract markdown summary mode keeps top-N sections", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/extract?url=${encodeURIComponent(upstreamUrl)}&format=markdown&mode=summary&max=1`,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.metadata.mode, "summary");
  // With max=1 we should have at most one ## heading in the output.
  const h2s = (body.content.match(/^##\s+/gm) || []).length;
  assert.ok(h2s <= 1, `expected <=1 h2, got ${h2s}`);
});

test("buildServer() boots with all defaults", async () => {
  const defaultApp = buildServer();
  await defaultApp.ready();
  const res = await defaultApp.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  await defaultApp.close();
});

test("GET /extract markdown handles content with no headings", async () => {
  const headinglessApp = buildServer({
    logger: false,
    deps: {
      isThinContent: () => false,
      fetchHtml: async () => ({
        html: `<html><body><article>${"<p>plain paragraph with words and commas, more text. </p>".repeat(15)}</article></body></html>`,
        finalUrl: "http://noheadings.test/",
        status: 200,
        contentType: "text/html",
      }),
    },
  });
  await headinglessApp.ready();

  const res = await headinglessApp.inject({
    method: "GET",
    url: "/extract?url=http://noheadings.test/&format=markdown",
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.metadata.section_count, 0);
  assert.ok(body.metadata.word_count > 10);

  await headinglessApp.close();
});

test("GET /extract triggers storage.save on cache miss with both formats", async () => {
  const calls = [];
  const stubStorage = {
    enabled: true,
    dir: "/tmp/test",
    formats: ["json", "markdown"],
    async save(args) {
      calls.push(args);
      return { dir: "/tmp/test/x", written: ["a.json", "a.markdown"] };
    },
  };
  const savingApp = buildServer({
    logger: false,
    deps: {
      isThinContent: () => false,
      storage: stubStorage,
      fetchHtml: async () => ({
        html: `<html><body><article>
          <h1>Save Me</h1>
          <p>${"prose with words and commas, lots of text. ".repeat(20)}</p>
        </article></body></html>`,
        finalUrl: "http://save.test/",
        status: 200,
        contentType: "text/html",
      }),
    },
  });
  await savingApp.ready();

  // Wait for the fire-and-forget save to land before asserting.
  const r1 = await savingApp.inject({ method: "GET", url: "/extract?url=http://save.test/" });
  assert.equal(r1.statusCode, 200);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.length, 1, "save should fire on the cache miss");
  assert.equal(calls[0].url, "http://save.test/");
  assert.equal(typeof calls[0].markdown, "string");
  assert.match(calls[0].markdown, /Save Me/);
  assert.equal(typeof calls[0].json, "object");
  assert.equal(calls[0].json.title, "Save Me");
  assert.equal(calls[0].json.metadata.format, "json");

  // A second request should hit cache and NOT save again.
  const r2 = await savingApp.inject({ method: "GET", url: "/extract?url=http://save.test/" });
  assert.equal(r2.headers["x-fastparse-cache"], "hit");
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1, "cache hit should not re-save");

  await savingApp.close();
});

test("GET /extract storage.save records rendered=true when renderer was used", async () => {
  const calls = [];
  const stubStorage = {
    enabled: true,
    dir: "/tmp/x",
    formats: ["json", "markdown"],
    async save(args) {
      calls.push(args);
      return { dir: "/tmp/x", written: [] };
    },
  };
  const renderedSavingApp = buildServer({
    logger: false,
    deps: {
      storage: stubStorage,
      fetchHtml: async () => ({
        html: `<html><body><div id="root"></div></body></html>`,
        finalUrl: "http://spa-save.test/",
        status: 200,
        contentType: "text/html",
      }),
      renderer: {
        render: async () => ({
          html: `<html><body><article><h1>SPA Save</h1>${"<p>rendered prose with words and commas, more text. </p>".repeat(20)}</article></body></html>`,
          finalUrl: "http://spa-save.test/",
          status: 200,
          contentType: "text/html",
          rendered: true,
        }),
        close: async () => {},
      },
    },
  });
  await renderedSavingApp.ready();
  await renderedSavingApp.inject({ method: "GET", url: "/extract?url=http://spa-save.test/" });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].json.metadata.rendered, true);

  await renderedSavingApp.close();
});

test("GET /extract continues to respond when storage.save fails", async () => {
  const failingStorage = {
    enabled: true,
    dir: "/tmp/test",
    formats: ["json", "markdown"],
    async save() {
      throw new Error("disk full");
    },
  };
  const app2 = buildServer({
    logger: false,
    deps: {
      isThinContent: () => false,
      storage: failingStorage,
      fetchHtml: async () => ({
        html: `<html><body><article><h1>X</h1><p>${"alpha alpha alpha alpha, ".repeat(20)}</p></article></body></html>`,
        finalUrl: "http://fail-save.test/",
        status: 200,
        contentType: "text/html",
      }),
    },
  });
  await app2.ready();

  const res = await app2.inject({ method: "GET", url: "/extract?url=http://fail-save.test/" });
  assert.equal(res.statusCode, 200, "storage failure must not break extraction");
  // Let the swallowed rejection settle so it doesn't bleed into the next test.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  await app2.close();
});

test("GET /extract does not call storage when storage.enabled=false", async () => {
  let called = false;
  const offStorage = {
    enabled: false,
    async save() {
      called = true;
    },
  };
  const app3 = buildServer({
    logger: false,
    deps: {
      isThinContent: () => false,
      storage: offStorage,
      fetchHtml: async () => ({
        html: `<html><body><article><h1>off</h1><p>${"x x x x x x x x x x x ".repeat(15)}</p></article></body></html>`,
        finalUrl: "http://off.test/",
        status: 200,
        contentType: "text/html",
      }),
    },
  });
  await app3.ready();
  await app3.inject({ method: "GET", url: "/extract?url=http://off.test/" });
  await new Promise((r) => setImmediate(r));
  assert.equal(called, false);
  await app3.close();
});

test("buildServer skips renderer.close when the renderer has no close()", async () => {
  // Some renderer implementations might be stateless and not provide a close()
  // method. The onClose hook should tolerate that.
  const noCloseApp = buildServer({
    logger: false,
    deps: {
      renderer: { render: async () => ({ html: "", finalUrl: "", rendered: true }) },
    },
  });
  await noCloseApp.ready();
  await noCloseApp.close();
});

test("GET /extract markdown reuses cached extraction across formats", async () => {
  let calls = 0;
  const dualApp = buildServer({
    logger: false,
    deps: {
      isThinContent: () => false,
      fetchHtml: async () => {
        calls++;
        return {
          html: `<html><body><article>
            <h1>Dual Format</h1>
            <h2>Section A</h2><p>${"alpha alpha alpha alpha, ".repeat(20)}</p>
            <h2>Section B</h2><p>${"bravo bravo bravo bravo, ".repeat(20)}</p>
          </article></body></html>`,
          finalUrl: "http://dual.test/",
          status: 200,
          contentType: "text/html",
        };
      },
    },
  });
  await dualApp.ready();

  const r1 = await dualApp.inject({ method: "GET", url: "/extract?url=http://dual.test/" });
  const r2 = await dualApp.inject({ method: "GET", url: "/extract?url=http://dual.test/&format=markdown" });
  const r3 = await dualApp.inject({ method: "GET", url: "/extract?url=http://dual.test/" });

  assert.equal(r1.headers["x-fastparse-cache"], "miss");
  assert.equal(r2.headers["x-fastparse-cache"], "hit");
  assert.equal(r3.headers["x-fastparse-cache"], "hit");
  assert.equal(calls, 1);

  assert.equal(r1.json().metadata.format, "json");
  assert.equal(r2.json().metadata.format, "markdown");
  assert.match(r2.json().content, /## Section A/);
  assert.match(r2.json().content, /## Section B/);

  await dualApp.close();
});

test("GET /extract markdown response sets metadata.rendered when renderer was used", async () => {
  const renderedApp = buildServer({
    logger: false,
    deps: {
      fetchHtml: async () => ({
        html: `<html><body><div id="root"></div></body></html>`,
        finalUrl: "http://spa-md.test/",
        status: 200,
        contentType: "text/html",
      }),
      renderer: {
        render: async () => ({
          html: `<html><body><article><h1>SPA</h1>${"<p>rendered prose with words and commas, more text. </p>".repeat(20)}</article></body></html>`,
          finalUrl: "http://spa-md.test/",
          status: 200,
          contentType: "text/html",
          rendered: true,
        }),
        close: async () => {},
      },
    },
  });
  await renderedApp.ready();

  const res = await renderedApp.inject({
    method: "GET",
    url: "/extract?url=http://spa-md.test/&format=markdown",
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.metadata.format, "markdown");
  assert.equal(body.metadata.rendered, true);
  assert.match(body.content, /rendered prose/);

  await renderedApp.close();
});

test("GET /extract rejects unknown ?format with 400", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/extract?url=${encodeURIComponent(upstreamUrl)}&format=xml`,
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /unknown format/);
});

test("GET /extract falls back gracefully when renderer fails on thin content", async () => {
  const fallbackApp = buildServer({
    logger: false,
    deps: {
      fetchHtml: async () => ({
        html: `<html><body><div id="root"></div></body></html>`,
        finalUrl: "http://spa.test/",
        status: 200,
        contentType: "text/html",
      }),
      renderer: {
        render: async () => {
          throw new Error("playwright not installed");
        },
        close: async () => {},
      },
    },
  });
  await fallbackApp.ready();

  // Thin content + failed renderer + cheerio body = single empty-ish section.
  const res = await fallbackApp.inject({ method: "GET", url: "/extract?url=http://spa.test/" });
  // Should not 500 — we degrade to whatever the original HTML had.
  assert.notEqual(res.statusCode, 500);
  await fallbackApp.close();
});
