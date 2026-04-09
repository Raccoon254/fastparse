// test/e2e/spa.test.js
//
// End-to-end test that exercises the real Playwright fallback path against
// a local SPA fixture. The fixture ships an empty <div id="root"></div>
// shell and only fills it in via JS after the page loads — so without a
// headless browser, fastparse would extract nothing useful. With Playwright
// it should pull out the rendered article.
//
// This file lives under test/e2e because it requires Playwright browsers
// to be installed (`npx playwright install chromium`). The unit and
// integration jobs skip it.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { buildServer } from "../../src/api/server.js";
import { createCache } from "../../src/cache/index.js";
import { createRenderer } from "../../src/render/index.js";

// Initial HTML is a near-empty SPA shell. The <script> populates #root with
// the actual article ~50ms after DOMContentLoaded.
const SPA_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>SPA Demo</title>
</head>
<body>
  <div id="root"></div>
  <script>
    setTimeout(() => {
      document.getElementById('root').innerHTML = \`
        <article>
          <h1>SPA Demo</h1>
          <h2>What this proves</h2>
          <p>This paragraph only exists after JavaScript runs in the page. A normal HTTP fetch would never see it, so fastparse must use its Playwright fallback to render the page before extraction. There are several commas, words, and prose-shaped sentences here so the scorer picks the article over any noise.</p>
          <p>A second paragraph reinforces that the rendered content is substantial enough to win the scoring contest cleanly. Words, commas, and more words.</p>
          <h2>Why local fixture</h2>
          <p>Hitting a public SPA from CI would be flaky and slow. A hermetic local fixture is fast, deterministic, and tests exactly the code path we care about — the thin-content detector triggering the renderer, the renderer launching chromium, and the extracted JSON containing the post-render headings.</p>
        </article>
      \`;
    }, 50);
  </script>
</body>
</html>`;

let upstream;
let upstreamUrl;
let app;

before(async () => {
  upstream = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(SPA_HTML);
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const { port } = upstream.address();
  upstreamUrl = `http://127.0.0.1:${port}/`;

  app = buildServer({
    logger: false,
    deps: {
      cache: createCache(),
      renderer: createRenderer(),
    },
  });
  await app.ready();
});

after(async () => {
  await app.close();
  await new Promise((r) => upstream.close(r));
});

test("extracts SPA content via real Playwright fallback", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/extract?url=${encodeURIComponent(upstreamUrl)}`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json();

  assert.equal(body.metadata.rendered, true, "should be flagged as rendered");

  const headings = body.sections.map((s) => s.heading);
  assert.ok(headings.includes("What this proves"), `headings=${headings.join(",")}`);
  assert.ok(headings.includes("Why local fixture"), `headings=${headings.join(",")}`);

  const allText = body.sections.map((s) => s.content).join(" ");
  assert.match(allText, /only exists after JavaScript runs/);
  assert.match(allText, /hermetic local fixture/);
});

test("second request to the same URL is served from cache", async () => {
  const r1 = await app.inject({
    method: "GET",
    url: `/extract?url=${encodeURIComponent(upstreamUrl)}`,
  });
  const r2 = await app.inject({
    method: "GET",
    url: `/extract?url=${encodeURIComponent(upstreamUrl)}`,
  });

  // The first request was served by the previous test, so r1 might be
  // either hit or miss depending on test ordering. r2 is definitely a hit.
  assert.equal(r2.headers["x-fastparse-cache"], "hit");
  assert.deepEqual(r2.json(), r1.json());
});
