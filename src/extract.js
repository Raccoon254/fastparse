// src/extract.js
//
// The fastparse engine as a plain async function. Wrap it in a server,
// call it from a CLI, embed it in another Node service — same pipeline,
// no Fastify required.
//
// Two entry points:
//   - extract(url, opts)             convenience using lazy default deps
//   - createExtractor(deps).extract  full DI for tests and custom wiring
//
// All errors thrown out of extract() are ExtractError instances with a
// stable `code` field so callers can map them to HTTP status, exit
// codes, or anything else.

import {
  fetchHtml as defaultFetchHtml,
  FetchError,
} from "./fetch/index.js";
import {
  parseHtml as defaultParseHtml,
  getTitle as defaultGetTitle,
} from "./parse/index.js";
import { findMainContent as defaultFindMainContent } from "./extract/index.js";
import {
  toSections as defaultToSections,
  buildDocument as defaultBuildDocument,
} from "./format/index.js";
import { toMarkdown as defaultToMarkdown } from "./format/markdown.js";
import { isThinContent as defaultIsThinContent } from "./render/detect.js";
import { createRenderer } from "./render/index.js";
import { optimizeDocument as defaultOptimizeDocument } from "./optimize/index.js";
import { optimizeMarkdown as defaultOptimizeMarkdown } from "./optimize/markdown.js";
import { createCache } from "./cache/index.js";
import { createLimiter } from "./limit/index.js";
import { createStorage } from "./storage/index.js";

export class ExtractError extends Error {
  constructor(code, message, { url, status, cause } = {}) {
    super(message);
    this.name = "ExtractError";
    this.code = code;
    this.url = url;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

const NOOP_LOGGER = { warn() {} };

/**
 * Build a reusable extractor with explicit dependency injection. Every
 * dependency is optional; defaults wire up the production pipeline with
 * an in-memory cache, an in-process limiter, a disabled storage, and a
 * lazy Playwright renderer.
 *
 * @param {object} [deps]
 * @returns {{
 *   extract: (url: string, opts?: object) => Promise<object>,
 *   cache: object,
 *   limiter: object,
 *   storage: object,
 *   renderer: object,
 * }}
 */
export function createExtractor(deps = {}) {
  const fetchHtml = deps.fetchHtml ?? defaultFetchHtml;
  const parseHtml = deps.parseHtml ?? defaultParseHtml;
  const getTitle = deps.getTitle ?? defaultGetTitle;
  const findMainContent = deps.findMainContent ?? defaultFindMainContent;
  const toSections = deps.toSections ?? defaultToSections;
  const buildDocument = deps.buildDocument ?? defaultBuildDocument;
  const toMarkdown = deps.toMarkdown ?? defaultToMarkdown;
  const isThinContent = deps.isThinContent ?? defaultIsThinContent;
  const optimizeDocument = deps.optimizeDocument ?? defaultOptimizeDocument;
  const optimizeMarkdown = deps.optimizeMarkdown ?? defaultOptimizeMarkdown;
  const cache = deps.cache ?? createCache();
  const renderer = deps.renderer ?? createRenderer();
  const limiter = deps.limiter ?? createLimiter();
  const storage = deps.storage ?? createStorage();
  const logger = deps.logger ?? NOOP_LOGGER;

  async function extract(url, opts = {}) {
    if (!url || typeof url !== "string") {
      throw new ExtractError("invalid-url", "url is required", { url });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new ExtractError("invalid-url", "invalid url", { url });
    }
    if (!/^https?:$/.test(parsedUrl.protocol)) {
      throw new ExtractError(
        "invalid-url",
        "only http and https are supported",
        { url },
      );
    }

    const {
      format = "json",
      mode = "full",
      maxSections,
      fresh = false,
    } = opts;

    if (format !== "json" && format !== "markdown") {
      throw new ExtractError(
        "invalid-format",
        `unknown format: ${format} (expected "json" or "markdown")`,
        { url },
      );
    }
    if (mode !== "full" && mode !== "summary") {
      throw new ExtractError(
        "invalid-mode",
        `unknown mode: ${mode} (expected "full" or "summary")`,
        { url },
      );
    }
    if (
      maxSections !== undefined &&
      (!Number.isInteger(maxSections) || maxSections <= 0)
    ) {
      throw new ExtractError(
        "invalid-max",
        "maxSections must be a positive integer",
        { url },
      );
    }

    const optimizeOpts = { mode };
    if (maxSections !== undefined) optimizeOpts.maxSections = maxSections;

    const cacheKey = url;
    let entry = fresh ? undefined : cache.get(cacheKey);
    let cacheStatus = entry ? "hit" : "miss";

    if (!entry) {
      const host = parsedUrl.host;
      let html, finalUrl;
      try {
        ({ html, finalUrl } = await limiter.run(host, () => fetchHtml(url)));
      } catch (err) {
        if (err instanceof FetchError) {
          throw new ExtractError("fetch-failed", err.message, {
            url,
            status: err.status,
            cause: err,
          });
        }
        throw err;
      }
      let rendered = false;
      if (isThinContent(html)) {
        try {
          const r = await limiter.run(host, () => renderer.render(url));
          html = r.html;
          finalUrl = r.finalUrl;
          rendered = true;
        } catch (err) {
          logger.warn(
            { url, err: err.message },
            "renderer fallback failed, returning thin content as-is",
          );
        }
      }

      const $ = parseHtml(html);
      const title = getTitle($);
      const container = findMainContent($);
      if (!container) {
        throw new ExtractError("no-content", "no extractable content", {
          url,
        });
      }
      const sections = toSections($, container);
      const containerHtml = $.html(container);

      entry = {
        title,
        finalUrl,
        rendered,
        sections,
        containerHtml,
        extractedAt: new Date().toISOString(),
      };
      cache.set(cacheKey, entry);

      if (storage.enabled) {
        archiveEntry(url, entry).catch((err) => {
          logger.warn(
            { url, err: err.message },
            "storage save failed",
          );
        });
      }
    }

    const response = renderResponse(entry, format, optimizeOpts);
    response.cacheStatus = cacheStatus;
    return response;
  }

  function archiveEntry(url, entry) {
    const { title, finalUrl, rendered, sections, containerHtml, extractedAt } =
      entry;
    const jsonDoc = optimizeDocument(
      buildDocument({ url: finalUrl, title, sections }),
      {},
    );
    jsonDoc.metadata.extracted_at = extractedAt;
    if (rendered) jsonDoc.metadata.rendered = true;
    jsonDoc.metadata.format = "json";
    const markdown = toMarkdown(containerHtml, { baseUrl: finalUrl });
    return storage.save({ url, json: jsonDoc, markdown });
  }

  function renderResponse(entry, format, optimizeOpts) {
    const { title, finalUrl, rendered, sections, containerHtml, extractedAt } =
      entry;

    if (format === "markdown") {
      let md = toMarkdown(containerHtml, { baseUrl: finalUrl });
      md = optimizeMarkdown(md, optimizeOpts);
      const wordCount = md.split(/\s+/).filter(Boolean).length;
      const sectionCount = (md.match(/^#{1,6}\s+/gm) || []).length;
      const out = {
        title,
        url: finalUrl,
        content: md,
        metadata: {
          word_count: wordCount,
          section_count: sectionCount,
          extracted_at: extractedAt,
          mode: optimizeOpts.mode,
          format: "markdown",
        },
      };
      if (rendered) out.metadata.rendered = true;
      return out;
    }

    const rawDoc = buildDocument({ url: finalUrl, title, sections });
    rawDoc.metadata.extracted_at = extractedAt;
    if (rendered) rawDoc.metadata.rendered = true;
    const optimised = optimizeDocument(rawDoc, optimizeOpts);
    optimised.metadata.format = "json";
    return optimised;
  }

  return { extract, cache, limiter, storage, renderer };
}

// One-shot convenience: lazily build a single default extractor and run it.
let _defaultExtractor;
export async function extract(url, opts) {
  if (!_defaultExtractor) _defaultExtractor = createExtractor();
  return _defaultExtractor.extract(url, opts);
}

// Test hook for resetting the lazy default. Not part of the public API.
export function _resetDefaultExtractor() {
  _defaultExtractor = undefined;
}
