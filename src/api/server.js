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
import { createCache } from "../cache/index.js";
import { isThinContent as defaultIsThinContent } from "../render/detect.js";
import { createRenderer } from "../render/index.js";

export function buildServer({ logger = true, deps = {} } = {}) {
  const fetchHtml = deps.fetchHtml ?? defaultFetchHtml;
  const parseHtml = deps.parseHtml ?? defaultParseHtml;
  const getTitle = deps.getTitle ?? defaultGetTitle;
  const findMainContent = deps.findMainContent ?? defaultFindMainContent;
  const toSections = deps.toSections ?? defaultToSections;
  const buildDocument = deps.buildDocument ?? defaultBuildDocument;
  const isThinContent = deps.isThinContent ?? defaultIsThinContent;
  const cache = deps.cache ?? createCache();
  const renderer = deps.renderer ?? createRenderer();

  const app = Fastify({ logger });

  app.get("/health", async () => ({ ok: true }));

  app.get("/extract", async (req, reply) => {
    const { url, fresh } = req.query;
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

    const cacheKey = url;
    const bypassCache = fresh === "1" || fresh === "true";
    if (!bypassCache) {
      const hit = cache.get(cacheKey);
      if (hit) {
        reply.header("x-fastparse-cache", "hit");
        return hit;
      }
    }
    reply.header("x-fastparse-cache", "miss");

    try {
      let { html, finalUrl } = await fetchHtml(url);
      let rendered = false;

      if (isThinContent(html)) {
        try {
          const r = await renderer.render(url);
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
      const doc = buildDocument({ url: finalUrl, title, sections });
      if (rendered) doc.metadata.rendered = true;

      cache.set(cacheKey, doc);
      return doc;
    } catch (err) {
      if (err instanceof FetchError) {
        return reply.code(502).send({ error: err.message, url: err.url });
      }
      req.log.error(err);
      return reply.code(500).send({ error: "internal error" });
    }
  });

  app.addHook("onClose", async () => {
    if (typeof renderer.close === "function") {
      await renderer.close();
    }
  });

  return app;
}
