import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtml } from "../../src/parse/index.js";
import { toSections, buildDocument } from "../../src/format/index.js";

test("toSections splits content at headings", () => {
  const html = `
    <article>
      <h2>First</h2>
      <p>first paragraph</p>
      <p>second paragraph</p>
      <h2>Second</h2>
      <p>another paragraph</p>
    </article>
  `;
  const $ = parseHtml(html);
  const sections = toSections($, $("article"));

  assert.equal(sections.length, 2);
  assert.equal(sections[0].heading, "First");
  assert.ok(sections[0].content.includes("first paragraph"));
  assert.ok(sections[0].content.includes("second paragraph"));
  assert.equal(sections[1].heading, "Second");
  assert.ok(sections[1].content.includes("another paragraph"));
});

test("toSections falls back to single section when no headings", () => {
  const html = `<article><p>just some text</p></article>`;
  const $ = parseHtml(html);
  const sections = toSections($, $("article"));
  assert.equal(sections.length, 1);
  assert.equal(sections[0].heading, "");
  assert.equal(sections[0].content, "just some text");
});

test("toSections collapses whitespace within blocks", () => {
  const html = `<article><p>spaced     out\n  text   here</p></article>`;
  const $ = parseHtml(html);
  const sections = toSections($, $("article"));
  assert.equal(sections[0].content, "spaced out text here");
});

test("toSections includes list items, blockquotes, and pre blocks", () => {
  const html = `
    <article>
      <h2>Heading</h2>
      <li>list item one</li>
      <blockquote>quoted text</blockquote>
      <pre>preformatted</pre>
    </article>
  `;
  const $ = parseHtml(html);
  const sections = toSections($, $("article"));
  const content = sections[0].content;
  assert.ok(content.includes("list item one"));
  assert.ok(content.includes("quoted text"));
  assert.ok(content.includes("preformatted"));
});

test("toSections falls back to whole-text section when no recognized blocks", () => {
  // Container has text only inside <span>, which toSections doesn't iterate.
  const html = `<article><span>orphan text not in a recognized block</span></article>`;
  const $ = parseHtml(html);
  const sections = toSections($, $("article"));
  assert.equal(sections.length, 1);
  assert.equal(sections[0].heading, "");
  assert.equal(sections[0].content, "orphan text not in a recognized block");
});

test("toSections returns empty array when container has no text at all", () => {
  const html = `<article><span></span></article>`;
  const $ = parseHtml(html);
  const sections = toSections($, $("article"));
  assert.equal(sections.length, 0);
});

test("toSections skips empty paragraphs and headings during iteration", () => {
  const html = `
    <article>
      <h2></h2>
      <p></p>
      <h2>Real</h2>
      <p>real text</p>
      <p>   </p>
    </article>
  `;
  const $ = parseHtml(html);
  const sections = toSections($, $("article"));
  assert.equal(sections.length, 1);
  assert.equal(sections[0].heading, "Real");
  assert.equal(sections[0].content, "real text");
});

test("buildDocument sets word_count, section_count, ISO timestamp", () => {
  const sections = [
    { heading: "A", content: "one two three" },
    { heading: "B", content: "four five" },
  ];
  const doc = buildDocument({
    url: "https://example.test/",
    title: "T",
    sections,
  });
  assert.equal(doc.title, "T");
  assert.equal(doc.url, "https://example.test/");
  assert.equal(doc.metadata.word_count, 5);
  assert.equal(doc.metadata.section_count, 2);
  assert.match(
    doc.metadata.extracted_at,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
});
