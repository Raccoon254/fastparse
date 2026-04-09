// src/optimize/markdown.js
//
// Apply the same shape of optimization to a markdown string that
// optimizeDocument applies to {sections}. Splits the markdown on h2+
// heading lines (`##`, `###`, …), treating everything before the first
// h2 as a preamble that always survives. In `summary` mode it keeps the
// longest N sections in original order.

const SECTION_HEADING_RE = /^(#{2,6})\s+(.*)$/;
const DEFAULT_SUMMARY_SECTIONS = 5;

/**
 * @param {string} markdown
 * @param {object} [opts]
 * @param {"full"|"summary"} [opts.mode]
 * @param {number} [opts.maxSections]
 * @returns {string}
 */
export function optimizeMarkdown(markdown, opts = {}) {
  const { mode = "full", maxSections } = opts;
  if (mode !== "summary") return markdown;

  const limit = maxSections ?? DEFAULT_SUMMARY_SECTIONS;
  const { preamble, sections } = splitDocument(markdown);

  if (sections.length === 0) return markdown;

  const kept = sections
    .map((s, originalIndex) => ({ ...s, originalIndex }))
    .sort((a, b) => b.body.length - a.body.length)
    .slice(0, limit)
    .sort((a, b) => a.originalIndex - b.originalIndex);

  const parts = [];
  if (preamble) parts.push(preamble);
  for (const s of kept) {
    parts.push(`${"#".repeat(s.level)} ${s.heading}\n\n${s.body}`.trim());
  }
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function splitDocument(markdown) {
  const lines = markdown.split("\n");
  const preambleLines = [];
  const sections = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(SECTION_HEADING_RE);
    if (m) {
      if (current) sections.push(finalize(current));
      current = { level: m[1].length, heading: m[2].trim(), bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  if (current) sections.push(finalize(current));

  return {
    preamble: preambleLines.join("\n").trim(),
    sections,
  };
}

function finalize(s) {
  return {
    level: s.level,
    heading: s.heading,
    body: s.bodyLines.join("\n").trim(),
  };
}
