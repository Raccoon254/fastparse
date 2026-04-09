// src/score/index.js
// Score a candidate node by text density vs link density vs raw length.
// Higher score = more likely to be the main content container.

const BLOCK_TAGS = new Set([
  "article",
  "main",
  "section",
  "div",
  "td",
  "li",
]);

const POSITIVE_HINTS =
  /(article|content|main|body|entry|post|story|text|markdown|prose)/i;
const NEGATIVE_HINTS =
  /(comment|meta|footer|header|nav|sidebar|aside|menu|promo|related|share|social|breadcrumb|pagination|widget|sponsor|ads?)/i;

/**
 * @param {import("cheerio").CheerioAPI} $
 * @param {import("cheerio").Element} el
 * @returns {number}
 */
export function scoreNode($, el) {
  if (!el || !el.tagName) return 0;
  if (!BLOCK_TAGS.has(el.tagName)) return 0;

  const $el = $(el);
  const text = $el.text().replace(/\s+/g, " ").trim();
  const textLen = text.length;
  if (textLen < 100) return 0;

  // Link density penalty.
  const linkText = $el.find("a").text().replace(/\s+/g, " ").trim().length;
  const linkDensity = linkText / Math.max(textLen, 1);

  // Reward paragraphs.
  const pCount = $el.find("p").length;

  // Reward commas (rough proxy for prose).
  const commaCount = (text.match(/,/g) || []).length;

  let score = 0;
  score += Math.min(textLen / 100, 50); // up to +50 for length
  score += pCount * 3;
  score += commaCount;
  score -= linkDensity * 50; // heavy penalty for link-heavy nodes

  // Class/id hints.
  const classId = `${$el.attr("class") || ""} ${$el.attr("id") || ""}`;
  if (POSITIVE_HINTS.test(classId)) score += 25;
  if (NEGATIVE_HINTS.test(classId)) score -= 25;

  // Semantic tag bonus.
  if (el.tagName === "article") score += 30;
  if (el.tagName === "main") score += 20;

  return score;
}
