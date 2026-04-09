import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtml } from "../../src/parse/index.js";
import { findMainContent } from "../../src/extract/index.js";

test("findMainContent uses fast path for <article>", () => {
  const html = `
    <html><body>
      <div>some sidebar content that is long enough to maybe score, but should lose</div>
      <article>
        <h1>headline</h1>
        <p>${"the article body has plenty of words, commas, and prose to win. ".repeat(10)}</p>
      </article>
    </body></html>
  `;
  const $ = parseHtml(html);
  const winner = findMainContent($);
  assert.ok(winner);
  assert.equal(winner[0].tagName, "article");
});

test("findMainContent uses fast path for <main>", () => {
  const html = `
    <html><body>
      <main>
        <p>${"main element content with enough text to qualify for the fast path. ".repeat(10)}</p>
      </main>
    </body></html>
  `;
  const $ = parseHtml(html);
  const winner = findMainContent($);
  assert.ok(winner);
  assert.equal(winner[0].tagName, "main");
});

test("findMainContent falls back to scoring when no article/main", () => {
  const html = `
    <html><body>
      <div class="sidebar"><p>${"link link link, ".repeat(20)}</p></div>
      <div class="post-body"><p>${"real prose content with words and commas, more text, ".repeat(15)}</p></div>
    </body></html>
  `;
  const $ = parseHtml(html);
  const winner = findMainContent($);
  assert.ok(winner);
  assert.ok(winner.text().includes("real prose content"));
});

test("findMainContent returns body as last resort", () => {
  const html = `<html><body><p>short</p></body></html>`;
  const $ = parseHtml(html);
  const winner = findMainContent($);
  assert.ok(winner);
  assert.equal(winner[0].tagName, "body");
});

test("findMainContent skips fast path when <article> is too short", () => {
  const html = `
    <html><body>
      <article><p>tiny</p></article>
      <div class="post-body"><p>${"a real long paragraph with words and commas, more prose here, ".repeat(20)}</p></div>
    </body></html>
  `;
  const $ = parseHtml(html);
  const winner = findMainContent($);
  assert.ok(winner);
  assert.ok(
    winner.text().includes("real long paragraph"),
    "should pick the post-body, not the tiny article",
  );
});

test("findMainContent skips fast path when <main> is too short", () => {
  const html = `
    <html><body>
      <main><p>tiny</p></main>
      <div class="post-body"><p>${"another long paragraph with words and commas, more prose, ".repeat(20)}</p></div>
    </body></html>
  `;
  const $ = parseHtml(html);
  const winner = findMainContent($);
  assert.ok(winner);
  assert.ok(winner.text().includes("another long paragraph"));
});

test("findMainContent returns null when document has no body", () => {
  // Use cheerio fragment-mode to construct a document without <body>.
  const html = `<p>orphan</p>`;
  const $ = parseHtml(html);
  // sanity: cheerio wraps the fragment in <html><head/><body/></html>, so
  // body still exists. Verify the contract: when body.length is 0 we get
  // null. Build that condition by removing the body.
  $("body").remove();
  const winner = findMainContent($);
  assert.equal(winner, null);
});
