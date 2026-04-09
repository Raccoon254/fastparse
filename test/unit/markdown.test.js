import { test } from "node:test";
import assert from "node:assert/strict";
import { toMarkdown } from "../../src/format/markdown.js";

test("toMarkdown converts headings to atx style", () => {
  const md = toMarkdown(
    "<article><h1>Big</h1><h2>Smaller</h2><h3>Tiny</h3></article>",
  );
  assert.match(md, /^# Big/m);
  assert.match(md, /^## Smaller/m);
  assert.match(md, /^### Tiny/m);
});

test("toMarkdown turns paragraphs into double-newline-separated text", () => {
  const md = toMarkdown("<article><p>one</p><p>two</p></article>");
  assert.equal(md, "one\n\ntwo");
});

test("toMarkdown keeps inline emphasis and code", () => {
  const md = toMarkdown(
    "<article><p>plain <strong>bold</strong> and <em>italic</em> and <code>x</code></p></article>",
  );
  assert.match(md, /\*\*bold\*\*/);
  assert.match(md, /_italic_/);
  assert.match(md, /`x`/);
});

test("toMarkdown emits unordered and ordered lists", () => {
  const md = toMarkdown(
    "<article><ul><li>a</li><li>b</li></ul><ol><li>one</li><li>two</li></ol></article>",
  );
  assert.match(md, /^-\s+a$/m);
  assert.match(md, /^-\s+b$/m);
  assert.match(md, /^1\.\s+one$/m);
  assert.match(md, /^2\.\s+two$/m);
});

test("toMarkdown emits fenced code blocks for <pre>", () => {
  const md = toMarkdown(
    "<article><pre><code>const x = 1;</code></pre></article>",
  );
  assert.match(md, /```/);
  assert.match(md, /const x = 1;/);
});

test("toMarkdown emits blockquotes", () => {
  const md = toMarkdown("<article><blockquote>hello</blockquote></article>");
  assert.match(md, /^> hello/m);
});

test("toMarkdown resolves relative href against baseUrl", () => {
  const md = toMarkdown(
    '<article><p>see <a href="/about">about</a></p></article>',
    { baseUrl: "https://example.test/blog/post" },
  );
  assert.match(md, /\[about\]\(https:\/\/example\.test\/about\)/);
});

test("toMarkdown resolves relative img src against baseUrl", () => {
  const md = toMarkdown(
    '<article><img src="/img/x.png" alt="X"></article>',
    { baseUrl: "https://example.test/blog/" },
  );
  assert.match(md, /!\[X\]\(https:\/\/example\.test\/img\/x\.png\)/);
});

test("toMarkdown leaves links alone when no baseUrl is given", () => {
  const md = toMarkdown(
    '<article><a href="/x">x</a></article>',
  );
  assert.match(md, /\[x\]\(\/x\)/);
});

test("toMarkdown skips invalid relative URLs without crashing", () => {
  // Pass a baseUrl that can't resolve some hrefs gracefully.
  const md = toMarkdown(
    '<article><a href="">empty</a><a href="//valid.test/x">ok</a></article>',
    { baseUrl: "https://example.test/" },
  );
  // The empty href is dropped by absoluteUrl returning null and the original
  // href stays. The ok one resolves through new URL().
  assert.match(md, /empty/);
  assert.match(md, /valid\.test/);
});

test("toMarkdown leaves malformed URLs alone instead of throwing", () => {
  // 'http://[' is rejected by `new URL()` so absoluteUrl falls into the
  // catch block and returns null, leaving the original attribute.
  const md = toMarkdown(
    '<article><a href="http://[">broken</a></article>',
    { baseUrl: "https://example.test/" },
  );
  assert.match(md, /broken/);
});

test("toMarkdown collapses runs of more than two newlines", () => {
  // Multiple <hr> separators in a row used to produce 4+ newlines.
  const md = toMarkdown(
    "<article><p>one</p><hr><hr><hr><p>two</p></article>",
  );
  assert.doesNotMatch(md, /\n\n\n/);
});

test("toMarkdown drops script and style content", () => {
  const md = toMarkdown(
    "<article><p>real</p><script>SCRIPT_NOISE</script><style>STYLE_NOISE</style></article>",
  );
  assert.doesNotMatch(md, /SCRIPT_NOISE/);
  assert.doesNotMatch(md, /STYLE_NOISE/);
  assert.match(md, /real/);
});
