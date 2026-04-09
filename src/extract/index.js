// src/extract/index.js
// Walk the cleaned DOM, score every block-ish node, and return the winner.

import { scoreNode } from "../score/index.js";

/**
 * Find the best content container in the parsed document.
 * @param {import("cheerio").CheerioAPI} $
 * @returns {import("cheerio").Cheerio | null}
 */
export function findMainContent($) {
  // Fast path: a single <article> or <main> usually wins.
  const article = $("article").first();
  if (article.length && article.text().trim().length > 200) {
    return article;
  }
  const main = $("main").first();
  if (main.length && main.text().trim().length > 200) {
    return main;
  }

  // Otherwise, score every candidate.
  let best = null;
  let bestScore = 0;

  $("article, main, section, div, td, li").each((_, el) => {
    const score = scoreNode($, el);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  });

  if (best) return $(best);

  // Last resort: <body>.
  const body = $("body").first();
  return body.length ? body : null;
}
