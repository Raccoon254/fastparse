import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { buildServer } from "../../src/api/server.js";

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

  app = buildServer({ logger: false });
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
        html: "<html></html>",
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
        html: "<html></html>",
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
