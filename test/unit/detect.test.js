import { test } from "node:test";
import assert from "node:assert/strict";
import { isThinContent } from "../../src/render/detect.js";

test("isThinContent returns true for empty/falsy input", () => {
  assert.equal(isThinContent(""), true);
  assert.equal(isThinContent(null), true);
  assert.equal(isThinContent(undefined), true);
  assert.equal(isThinContent(123), true);
});

test("isThinContent returns true for an SPA shell", () => {
  const html = `
    <!doctype html>
    <html><head><title>App</title></head>
    <body><div id="root"></div><script src="/app.js"></script></body>
    </html>
  `;
  assert.equal(isThinContent(html), true);
});

test("isThinContent returns true when 'enable javascript' is mentioned", () => {
  const html = `
    <html><body>
      ${"<p>filler text </p>".repeat(100)}
      <noscript>You need to enable JavaScript to run this app.</noscript>
    </body></html>
  `;
  assert.equal(isThinContent(html), true);
});

test("isThinContent returns false for a real article", () => {
  const html = `
    <html><body><article>
      <h1>Title</h1>
      ${"<p>This is a paragraph with enough text content to be considered substantial. It has many words, lots of commas, and prose-like sentences.</p>".repeat(10)}
    </article></body></html>
  `;
  assert.equal(isThinContent(html), false);
});

test("isThinContent ignores text inside <script> and <style>", () => {
  const html = `
    <html><head>
      <style>${"body { color: red; }".repeat(200)}</style>
      <script>${"const x = 1;".repeat(200)}</script>
    </head><body><div></div></body></html>
  `;
  assert.equal(isThinContent(html), true);
});
