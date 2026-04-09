// src/format/markdown.js
//
// Convert the chosen content container into clean markdown. Uses turndown
// for the heavy lifting (it handles nested lists, code blocks, blockquotes,
// inline emphasis, etc) and pre-processes the HTML to resolve any relative
// href/src attributes against the page's final URL so the markdown stays
// useful when the source disappears.

import * as cheerio from "cheerio";
import TurndownService from "turndown";

const td = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "_",
  hr: "---",
  linkStyle: "inlined",
});

// Drop attributes turndown would otherwise pass through as raw HTML in some
// edge cases — we already cleaned the DOM upstream.
td.remove(["script", "style", "noscript", "iframe", "svg"]);

/**
 * @param {string} containerHtml  HTML of the chosen content container
 * @param {object} [opts]
 * @param {string} [opts.baseUrl]  used to resolve relative href/src
 * @returns {string} markdown
 */
export function toMarkdown(containerHtml, { baseUrl } = {}) {
  let html = containerHtml;

  if (baseUrl) {
    const $ = cheerio.load(html);
    $("a[href]").each((_, el) => {
      const $el = $(el);
      const abs = absoluteUrl($el.attr("href"), baseUrl);
      if (abs) $el.attr("href", abs);
    });
    $("img[src]").each((_, el) => {
      const $el = $(el);
      const abs = absoluteUrl($el.attr("src"), baseUrl);
      if (abs) $el.attr("src", abs);
    });
    html = $.html();
  }

  return td
    .turndown(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function absoluteUrl(href, baseUrl) {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}
