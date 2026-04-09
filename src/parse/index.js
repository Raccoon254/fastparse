// src/parse/index.js
// Load HTML into cheerio and strip obvious non-content nodes.

import * as cheerio from "cheerio";

const STRIP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "canvas",
  "nav",
  "footer",
  "header",
  "aside",
  "form",
  "button",
  "input",
  "select",
  "textarea",
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[aria-hidden="true"]',
  ".nav",
  ".navbar",
  ".navigation",
  ".menu",
  ".sidebar",
  ".footer",
  ".header",
  ".cookie",
  ".cookies",
  ".consent",
  ".advert",
  ".advertisement",
  ".ads",
  ".social",
  ".share",
  ".breadcrumb",
  ".breadcrumbs",
  ".pagination",
  ".comments",
  ".comment-list",
  // Real-world class names rarely use the bare token, so match substrings too.
  '[class*="cookie" i]',
  '[class*="consent" i]',
  '[class*="advert" i]',
  '[class*="newsletter" i]',
  '[class*="social-share" i]',
  '[id*="cookie" i]',
  '[id*="advert" i]',
];

/**
 * Parse HTML and remove non-content nodes. Returns a cheerio root.
 * @param {string} html
 * @returns {cheerio.CheerioAPI}
 */
export function parseHtml(html) {
  const $ = cheerio.load(html, { decodeEntities: true });

  // Drop comments.
  $("*")
    .contents()
    .each(function () {
      if (this.type === "comment") $(this).remove();
    });

  for (const sel of STRIP_SELECTORS) {
    $(sel).remove();
  }

  return $;
}

/**
 * Extract the page title from a parsed document.
 * @param {cheerio.CheerioAPI} $
 * @returns {string}
 */
export function getTitle($) {
  const og = $('meta[property="og:title"]').attr("content");
  if (og) return og.trim();
  const t = $("title").first().text();
  if (t) return t.trim();
  const h1 = $("h1").first().text();
  return h1 ? h1.trim() : "";
}
