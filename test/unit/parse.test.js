import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtml, getTitle } from "../../src/parse/index.js";

test("parseHtml strips script, style, nav, footer, aside", () => {
  const html = `
    <html><head><title>t</title></head><body>
      <nav>NAV_NOISE</nav>
      <header>HEADER_NOISE</header>
      <article><p>real content here</p></article>
      <aside>ASIDE_NOISE</aside>
      <footer>FOOTER_NOISE</footer>
      <script>SCRIPT_NOISE</script>
      <style>STYLE_NOISE</style>
    </body></html>
  `;
  const $ = parseHtml(html);
  const text = $("body").text();
  for (const noise of [
    "NAV_NOISE",
    "HEADER_NOISE",
    "ASIDE_NOISE",
    "FOOTER_NOISE",
    "SCRIPT_NOISE",
    "STYLE_NOISE",
  ]) {
    assert.ok(!text.includes(noise), `expected ${noise} to be stripped`);
  }
  assert.ok(text.includes("real content here"));
});

test("parseHtml strips class-based noise (cookies, ads, comments)", () => {
  const html = `
    <html><body>
      <div class="cookie-banner">COOKIE_NOISE</div>
      <div class="advertisement">AD_NOISE</div>
      <div class="comments">COMMENT_NOISE</div>
      <div class="real">keep me</div>
    </body></html>
  `;
  const $ = parseHtml(html);
  const text = $("body").text();
  assert.ok(!text.includes("COOKIE_NOISE"));
  assert.ok(!text.includes("AD_NOISE"));
  assert.ok(!text.includes("COMMENT_NOISE"));
  assert.ok(text.includes("keep me"));
});

test("parseHtml removes HTML comments", () => {
  const html = `<html><body><p>visible <!-- HIDDEN_COMMENT --> text</p></body></html>`;
  const $ = parseHtml(html);
  assert.ok(!$.html().includes("HIDDEN_COMMENT"));
});

test("getTitle prefers og:title over <title>", () => {
  const html = `
    <html><head>
      <meta property="og:title" content="OG Title">
      <title>HTML Title</title>
    </head><body><h1>H1 Title</h1></body></html>
  `;
  const $ = parseHtml(html);
  assert.equal(getTitle($), "OG Title");
});

test("getTitle falls back to <title> when no og:title", () => {
  const html = `<html><head><title>HTML Title</title></head><body><h1>H1 Title</h1></body></html>`;
  const $ = parseHtml(html);
  assert.equal(getTitle($), "HTML Title");
});

test("getTitle falls back to <h1> when no title", () => {
  const html = `<html><body><h1>H1 Title</h1></body></html>`;
  const $ = parseHtml(html);
  assert.equal(getTitle($), "H1 Title");
});

test("getTitle returns empty string when nothing is available", () => {
  const $ = parseHtml(`<html><body><p>no title</p></body></html>`);
  assert.equal(getTitle($), "");
});
