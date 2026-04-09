import { test } from "node:test";
import assert from "node:assert/strict";
import { optimizeDocument } from "../../src/optimize/index.js";

const makeDoc = (sections) => ({
  title: "T",
  url: "http://x.test/",
  sections,
  metadata: { word_count: 0, section_count: sections.length, extracted_at: "fixed" },
});

test("optimizeDocument is pure (does not mutate input)", () => {
  const doc = makeDoc([
    { heading: "A", content: "one two three four five six" },
    { heading: "B", content: "seven eight nine ten eleven" },
  ]);
  const before = JSON.stringify(doc);
  optimizeDocument(doc);
  assert.equal(JSON.stringify(doc), before);
});

test("optimizeDocument drops headingless sections under minSectionWords", () => {
  const doc = makeDoc([
    { heading: "", content: "tiny" },
    { heading: "Real", content: "this section has plenty of words to keep" },
    { heading: "", content: "still tiny" },
  ]);
  const out = optimizeDocument(doc, { minSectionWords: 5 });
  assert.equal(out.sections.length, 1);
  assert.equal(out.sections[0].heading, "Real");
});

test("optimizeDocument keeps tiny sections that have a heading", () => {
  const doc = makeDoc([
    { heading: "Has heading", content: "tiny" },
  ]);
  const out = optimizeDocument(doc, { minSectionWords: 10 });
  assert.equal(out.sections.length, 1);
});

test("optimizeDocument dedups paragraphs across sections", () => {
  const doc = makeDoc([
    { heading: "A", content: "Hello world.\n\nShared paragraph that repeats." },
    { heading: "B", content: "Shared paragraph that repeats.\n\nUnique to B." },
  ]);
  const out = optimizeDocument(doc);
  assert.equal(out.sections.length, 2);
  assert.match(out.sections[0].content, /Hello world/);
  assert.match(out.sections[0].content, /Shared paragraph/);
  assert.doesNotMatch(out.sections[1].content, /Shared paragraph/);
  assert.match(out.sections[1].content, /Unique to B/);
});

test("optimizeDocument normalises punctuation when comparing duplicates", () => {
  const doc = makeDoc([
    { heading: "A", content: "Hello, World!" },
    { heading: "B", content: "hello world" },
  ]);
  const out = optimizeDocument(doc);
  // Both normalise to "hello world", so the second occurrence drops out.
  // Section B becomes empty, has a heading, so it's kept (heading-only).
  assert.equal(out.sections[0].content, "Hello, World!");
  assert.equal(out.sections[1].content, "");
});

test("optimizeDocument drops sections that become empty after dedup AND have no heading", () => {
  const doc = makeDoc([
    { heading: "Keep", content: "duplicate paragraph here" },
    { heading: "", content: "duplicate paragraph here" },
  ]);
  const out = optimizeDocument(doc);
  assert.equal(out.sections.length, 1);
  assert.equal(out.sections[0].heading, "Keep");
});

test("optimizeDocument summary mode keeps top-N by length, in original order", () => {
  const doc = makeDoc([
    { heading: "First",  content: "x ".repeat(50) },   // medium
    { heading: "Second", content: "x ".repeat(10) },   // tiny but kept (heading)
    { heading: "Third",  content: "x ".repeat(200) },  // largest
    { heading: "Fourth", content: "x ".repeat(80) },   // medium-large
    { heading: "Fifth",  content: "x ".repeat(30) },   // smallest meaningful
  ]);
  const out = optimizeDocument(doc, { mode: "summary", maxSections: 3 });
  assert.equal(out.sections.length, 3);
  // Top 3 by length: Third (200), Fourth (80), First (50). In original order:
  // First, Third, Fourth.
  assert.deepEqual(
    out.sections.map((s) => s.heading),
    ["First", "Third", "Fourth"],
  );
});

test("optimizeDocument summary mode defaults to 5 sections", () => {
  const sections = Array.from({ length: 8 }, (_, i) => ({
    heading: `H${i}`,
    content: `${i} `.repeat(20 + i * 5),
  }));
  const out = optimizeDocument(makeDoc(sections), { mode: "summary" });
  assert.equal(out.sections.length, 5);
});

test("optimizeDocument recomputes word_count and section_count", () => {
  const doc = makeDoc([
    { heading: "A", content: "one two three" },
    { heading: "B", content: "four five" },
  ]);
  doc.metadata.word_count = 999; // wrong on purpose
  const out = optimizeDocument(doc);
  assert.equal(out.metadata.word_count, 5);
  assert.equal(out.metadata.section_count, 2);
});

test("optimizeDocument tags metadata with the active mode", () => {
  const doc = makeDoc([{ heading: "A", content: "one two three four five" }]);
  assert.equal(optimizeDocument(doc).metadata.mode, "full");
  assert.equal(
    optimizeDocument(doc, { mode: "summary" }).metadata.mode,
    "summary",
  );
});

test("optimizeDocument preserves unrelated metadata fields", () => {
  const doc = makeDoc([{ heading: "A", content: "one two three four five" }]);
  doc.metadata.extracted_at = "2026-04-09T00:00:00.000Z";
  doc.metadata.rendered = true;
  const out = optimizeDocument(doc);
  assert.equal(out.metadata.extracted_at, "2026-04-09T00:00:00.000Z");
  assert.equal(out.metadata.rendered, true);
});

test("optimizeDocument handles empty documents", () => {
  const doc = makeDoc([]);
  const out = optimizeDocument(doc);
  assert.equal(out.sections.length, 0);
  assert.equal(out.metadata.word_count, 0);
  assert.equal(out.metadata.section_count, 0);
});

test("optimizeDocument skips whitespace-only paragraphs during dedup", () => {
  const doc = makeDoc([
    { heading: "A", content: "real one\n\n   \n\nreal two" },
  ]);
  const out = optimizeDocument(doc);
  assert.equal(out.sections[0].content, "real one\n\nreal two");
});

test("optimizeDocument skips paragraphs that normalise to empty", () => {
  const doc = makeDoc([
    { heading: "A", content: "real text\n\n!!!\n\nmore text" },
  ]);
  const out = optimizeDocument(doc);
  // "!!!" normalises to "" so it's dropped, but "real text" and "more text"
  // both stay.
  assert.match(out.sections[0].content, /real text/);
  assert.match(out.sections[0].content, /more text/);
  assert.doesNotMatch(out.sections[0].content, /!!!/);
});
