// src/optimize/index.js
//
// Pure function that takes the raw extracted document and returns a slimmer
// version optimised for LLM consumption. Never mutates its input — the
// server caches the raw document and runs this on every response, so the
// same cache entry can serve different ?mode values cheaply.
//
// What it does:
//   1. Drops sections that are smaller than `minSectionWords` words AND
//      have no heading (no signal at all).
//   2. Dedups paragraphs across the whole document. Each paragraph is
//      normalised (lowercased, punctuation stripped, whitespace collapsed)
//      and the second-and-later occurrences are removed.
//   3. Drops sections that became empty after dedup.
//   4. In `summary` mode, keeps only the top `maxSections` sections by
//      content length, restoring document order afterwards.
//   5. Recomputes metadata so word_count and section_count reflect the
//      optimised output.

const DEFAULT_MIN_SECTION_WORDS = 5;
const DEFAULT_SUMMARY_SECTIONS = 5;

/**
 * @typedef {object} Section
 * @property {string} heading
 * @property {string} content
 *
 * @typedef {object} Doc
 * @property {string} title
 * @property {string} url
 * @property {Section[]} sections
 * @property {object} metadata
 */

/**
 * @param {Doc} doc
 * @param {object} [opts]
 * @param {"full"|"summary"} [opts.mode]
 * @param {number} [opts.maxSections]
 * @param {number} [opts.minSectionWords]
 * @returns {Doc}
 */
export function optimizeDocument(doc, opts = {}) {
  const {
    mode = "full",
    maxSections,
    minSectionWords = DEFAULT_MIN_SECTION_WORDS,
  } = opts;

  // Step 1: drop signal-less tiny sections.
  let sections = doc.sections
    .map((s, originalIndex) => ({ ...s, originalIndex }))
    .filter((s) => {
      if (s.heading) return true;
      return wordCount(s.content) >= minSectionWords;
    });

  // Step 2: dedup paragraphs across the entire document.
  const seen = new Set();
  for (const s of sections) {
    const paragraphs = s.content.split(/\n{2,}/);
    const kept = [];
    for (const p of paragraphs) {
      const trimmed = p.trim();
      if (!trimmed) continue;
      const key = normalize(trimmed);
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(trimmed);
    }
    s.content = kept.join("\n\n");
  }

  // Step 3: drop sections that became empty after dedup AND have no heading.
  sections = sections.filter((s) => s.content.length > 0 || s.heading);

  // Step 4: summary mode keeps the longest N, restored to original order.
  if (mode === "summary") {
    const limit = maxSections ?? DEFAULT_SUMMARY_SECTIONS;
    sections = [...sections]
      .sort((a, b) => b.content.length - a.content.length)
      .slice(0, limit)
      .sort((a, b) => a.originalIndex - b.originalIndex);
  }

  // Strip the originalIndex bookkeeping field.
  const cleanSections = sections.map(({ originalIndex: _i, ...rest }) => rest);

  // Step 5: recompute metadata.
  const newWordCount = cleanSections.reduce(
    (n, s) => n + wordCount(s.content),
    0,
  );

  return {
    title: doc.title,
    url: doc.url,
    sections: cleanSections,
    metadata: {
      ...doc.metadata,
      word_count: newWordCount,
      section_count: cleanSections.length,
      mode,
    },
  };
}

function wordCount(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
