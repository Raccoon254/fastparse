// src/render/detect.js
// Decide whether a fetched HTML document is "thin" — i.e. probably an SPA shell
// that needs JavaScript executed to fill in the actual content.

const MIN_TEXT_LENGTH = 500;
const ENABLE_JS_RE = /enable\s+javascript|please\s+turn\s+on\s+javascript|requires\s+javascript/i;

/**
 * Returns true if the document looks like it needs to be rendered with a
 * headless browser to get real content.
 * @param {string} html
 */
export function isThinContent(html) {
  if (!html || typeof html !== "string") return true;

  if (ENABLE_JS_RE.test(html)) return true;

  // Cheap text-only length: strip script/style, then tags, then collapse ws.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text.length < MIN_TEXT_LENGTH;
}
