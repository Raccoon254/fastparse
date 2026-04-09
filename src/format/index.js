// src/format/index.js
// Walk the chosen container and emit structured sections.

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * Convert a chosen content container into structured sections.
 * @param {import("cheerio").CheerioAPI} $
 * @param {import("cheerio").Cheerio} container
 * @returns {{heading: string, content: string}[]}
 */
export function toSections($, container) {
  const sections = [];
  let current = { heading: "", content: [] };

  const flush = () => {
    const text = current.content.join("\n\n").trim();
    if (text || current.heading) {
      sections.push({ heading: current.heading, content: text });
    }
  };

  // Iterate descendants in document order, but only direct text-bearing blocks.
  container.find("h1, h2, h3, h4, h5, h6, p, li, pre, blockquote").each((_, el) => {
    const tag = el.tagName;
    const $el = $(el);
    const text = $el.text().replace(/\s+/g, " ").trim();
    if (!text) return;

    if (HEADING_TAGS.has(tag)) {
      flush();
      current = { heading: text, content: [] };
    } else {
      current.content.push(text);
    }
  });

  flush();

  // If we got nothing structured, fall back to the whole text as one section.
  if (sections.length === 0) {
    const text = container.text().replace(/\s+/g, " ").trim();
    if (text) sections.push({ heading: "", content: text });
  }

  return sections;
}

/**
 * Build the final document envelope.
 */
export function buildDocument({ url, title, sections }) {
  const wordCount = sections.reduce((n, s) => {
    return n + s.content.split(/\s+/).filter(Boolean).length;
  }, 0);

  return {
    title,
    url,
    sections,
    metadata: {
      word_count: wordCount,
      section_count: sections.length,
      extracted_at: new Date().toISOString(),
    },
  };
}
