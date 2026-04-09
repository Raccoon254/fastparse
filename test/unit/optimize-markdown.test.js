import { test } from "node:test";
import assert from "node:assert/strict";
import { optimizeMarkdown } from "../../src/optimize/markdown.js";

const sampleDoc = `# Title

intro paragraph

## A short

x

## B long

${"long body line\n".repeat(20)}

## C medium

${"medium body line\n".repeat(8)}

## D longer

${"longer body line\n".repeat(15)}
`;

test("optimizeMarkdown is a no-op in full mode", () => {
  assert.equal(optimizeMarkdown(sampleDoc), sampleDoc);
  assert.equal(optimizeMarkdown(sampleDoc, { mode: "full" }), sampleDoc);
});

test("optimizeMarkdown summary keeps top-N sections in document order", () => {
  const out = optimizeMarkdown(sampleDoc, { mode: "summary", maxSections: 2 });
  // Top 2 by length: "B long" (20 lines) and "D longer" (15 lines).
  assert.match(out, /## B long/);
  assert.match(out, /## D longer/);
  assert.doesNotMatch(out, /## A short/);
  assert.doesNotMatch(out, /## C medium/);
  // Original order: B before D.
  assert.ok(out.indexOf("## B long") < out.indexOf("## D longer"));
});

test("optimizeMarkdown summary keeps the preamble before any heading", () => {
  const out = optimizeMarkdown(sampleDoc, { mode: "summary", maxSections: 1 });
  // Preamble = "# Title" + "intro paragraph" (everything before first ##).
  assert.match(out, /# Title/);
  assert.match(out, /intro paragraph/);
});

test("optimizeMarkdown summary defaults to 5 sections", () => {
  // 4 sections under top-level → all kept regardless of default.
  const out = optimizeMarkdown(sampleDoc, { mode: "summary" });
  assert.match(out, /## A short/);
  assert.match(out, /## B long/);
  assert.match(out, /## C medium/);
  assert.match(out, /## D longer/);
});

test("optimizeMarkdown returns markdown unchanged when there are no headings", () => {
  const md = "just some plain text\n\nwith two paragraphs";
  assert.equal(optimizeMarkdown(md, { mode: "summary" }), md);
});

test("optimizeMarkdown collapses excessive blank lines in summary output", () => {
  const out = optimizeMarkdown(sampleDoc, { mode: "summary", maxSections: 2 });
  assert.doesNotMatch(out, /\n\n\n/);
});
