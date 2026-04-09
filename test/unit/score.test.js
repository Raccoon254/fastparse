import { test } from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { scoreNode } from "../../src/score/index.js";

const load = (html) => cheerio.load(html);

test("scoreNode returns 0 for null and tag-less input", () => {
  const $ = load(`<div></div>`);
  assert.equal(scoreNode($, null), 0);
  assert.equal(scoreNode($, {}), 0);
});

test("scoreNode returns 0 for short text", () => {
  const $ = load(`<div>too short</div>`);
  assert.equal(scoreNode($, $("div")[0]), 0);
});

test("scoreNode returns 0 for non-block tags", () => {
  const $ = load(`<span>${"x".repeat(500)}</span>`);
  assert.equal(scoreNode($, $("span")[0]), 0);
});

test("scoreNode rewards long prose with paragraphs and commas", () => {
  const longProse =
    "This is a long paragraph with several commas, multiple clauses, and enough text to count. " +
    "It contains real prose-like sentences, with enough punctuation, that the scorer should reward it heavily.";
  const $ = load(
    `<div><p>${longProse}</p><p>${longProse}</p><p>${longProse}</p></div>`,
  );
  const score = scoreNode($, $("div")[0]);
  assert.ok(score > 20, `expected > 20, got ${score}`);
});

test("scoreNode penalizes link-heavy nodes", () => {
  const proseHtml = `<p>${"prose paragraph with words and commas, more words, ".repeat(10)}</p>`;
  const linksHtml = `<p>${"<a>link text here</a> ".repeat(40)}</p>`;
  const $a = load(`<div>${proseHtml}</div>`);
  const $b = load(`<div>${linksHtml}</div>`);
  const proseScore = scoreNode($a, $a("div")[0]);
  const linkScore = scoreNode($b, $b("div")[0]);
  assert.ok(
    proseScore > linkScore,
    `prose ${proseScore} should beat links ${linkScore}`,
  );
});

test("scoreNode rewards positive class hints", () => {
  const text = "x".repeat(300);
  const $a = load(`<div class="article-body"><p>${text}</p></div>`);
  const $b = load(`<div class="random"><p>${text}</p></div>`);
  assert.ok(
    scoreNode($a, $a("div")[0]) > scoreNode($b, $b("div")[0]),
  );
});

test("scoreNode penalizes negative class hints", () => {
  const text = "x".repeat(300);
  const $a = load(`<div class="random"><p>${text}</p></div>`);
  const $b = load(`<div class="sidebar"><p>${text}</p></div>`);
  assert.ok(
    scoreNode($a, $a("div")[0]) > scoreNode($b, $b("div")[0]),
  );
});

test("scoreNode gives semantic tag bonus to article and main", () => {
  const text =
    "long paragraph text, with several commas, and enough words to score, ".repeat(5);
  const $div = load(`<div><p>${text}</p></div>`);
  const $article = load(`<article><p>${text}</p></article>`);
  const $main = load(`<main><p>${text}</p></main>`);
  const divScore = scoreNode($div, $div("div")[0]);
  const articleScore = scoreNode($article, $article("article")[0]);
  const mainScore = scoreNode($main, $main("main")[0]);
  assert.ok(articleScore > divScore, "article should beat div");
  assert.ok(mainScore > divScore, "main should beat div");
  assert.ok(articleScore > mainScore, "article bonus is larger than main");
});
