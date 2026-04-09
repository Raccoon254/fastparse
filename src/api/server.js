// src/api/server.js
// Fastify HTTP server exposing GET /extract.

import Fastify from "fastify";
import {
  fetchHtml as defaultFetchHtml,
  FetchError,
} from "../fetch/index.js";
import {
  parseHtml as defaultParseHtml,
  getTitle as defaultGetTitle,
} from "../parse/index.js";
import { findMainContent as defaultFindMainContent } from "../extract/index.js";
import {
  toSections as defaultToSections,
  buildDocument as defaultBuildDocument,
} from "../format/index.js";
import { toMarkdown as defaultToMarkdown } from "../format/markdown.js";
import { createCache } from "../cache/index.js";
import { isThinContent as defaultIsThinContent } from "../render/detect.js";
import { createRenderer } from "../render/index.js";
import { optimizeDocument as defaultOptimizeDocument } from "../optimize/index.js";
import { optimizeMarkdown as defaultOptimizeMarkdown } from "../optimize/markdown.js";
import { createLimiter } from "../limit/index.js";
import { createStorage } from "../storage/index.js";

export function buildServer({ logger = true, deps = {} } = {}) {
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

  const app = Fastify({ logger });

  app.get("/health", async () => ({ ok: true }));

  app.get("/extract", async (req, reply) => {
    const { url, fresh, mode, max, format } = req.query;
    if (!url || typeof url !== "string") {
      return reply.code(400).send({ error: "missing required query param: url" });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return reply.code(400).send({ error: "invalid url" });
    }
    if (!/^https?:$/.test(parsedUrl.protocol)) {
      return reply.code(400).send({ error: "only http and https are supported" });
    }

    const outputFormat = format ?? "json";
    if (outputFormat !== "json" && outputFormat !== "markdown") {
      return reply
        .code(400)
        .send({ error: `unknown format: ${format} (expected "json" or "markdown")` });
    }

    const optimizeOpts = {};
    if (mode === "summary") optimizeOpts.mode = "summary";
    else if (mode && mode !== "full") {
      return reply
        .code(400)
        .send({ error: `unknown mode: ${mode} (expected "full" or "summary")` });
    }
    if (max !== undefined) {
      const n = Number(max);
      if (!Number.isInteger(n) || n <= 0) {
        return reply.code(400).send({ error: "max must be a positive integer" });
      }
      optimizeOpts.maxSections = n;
    }

    const cacheKey = url;
    const bypassCache = fresh === "1" || fresh === "true";
    let entry = bypassCache ? undefined : cache.get(cacheKey);
    if (entry) {
      reply.header("x-fastparse-cache", "hit");
      return renderResponse(entry, outputFormat, optimizeOpts);
    }
    reply.header("x-fastparse-cache", "miss");

    try {
      const host = parsedUrl.host;
      let { html, finalUrl } = await limiter.run(host, () => fetchHtml(url));
      let rendered = false;

      if (isThinContent(html)) {
        try {
          const r = await limiter.run(host, () => renderer.render(url));
          html = r.html;
          finalUrl = r.finalUrl;
          rendered = true;
        } catch (err) {
          req.log.warn(
            { url, err: err.message },
            "renderer fallback failed, returning thin content as-is",
          );
        }
      }

      const $ = parseHtml(html);
      const title = getTitle($);
      const container = findMainContent($);
      if (!container) {
        return reply.code(422).send({ error: "no extractable content" });
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

      // Archive both formats to disk if storage is enabled. Errors are
      // logged and swallowed — a disk problem must never break extraction.
      if (storage.enabled) {
        archiveEntry(req, url, entry).catch((err) => {
          req.log.warn(
            { url, err: err.message },
            "storage save failed",
          );
        });
      }

      return renderResponse(entry, outputFormat, optimizeOpts);
    } catch (err) {
      if (err instanceof FetchError) {
        return reply.code(502).send({ error: err.message, url: err.url });
      }
      req.log.error(err);
      return reply.code(500).send({ error: "internal error" });
    }
  });

  async function archiveEntry(req, url, entry) {
    const { title, finalUrl, rendered, sections, containerHtml, extractedAt } =
      entry;

    // Always archive the FULL versions, not the user-requested mode/max
    // slice. The query params control the response, not what's persisted.
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

  function renderResponse(entry, outputFormat, optimizeOpts) {
    const { title, finalUrl, rendered, sections, containerHtml, extractedAt } =
      entry;

    if (outputFormat === "markdown") {
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
          mode: optimizeOpts.mode ?? "full",
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

  app.addHook("onClose", async () => {
    if (typeof renderer.close === "function") {
      await renderer.close();
    }
  });

  return app;
}
