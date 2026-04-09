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
      fetchHtml: async () => {
        calls++;
        return {
          html: `<html><body><article>
            <h2>One</h2><p>${"x ".repeat(50)}</p>
            <h2>Two</h2><p>${"y ".repeat(100)}</p>
            <h2>Three</h2><p>${"z ".repeat(20)}</p>
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
