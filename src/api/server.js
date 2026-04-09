// src/api/server.js
// Fastify HTTP server exposing GET /extract.

import Fastify from "fastify";
import { fetchHtml, FetchError } from "../fetch/index.js";
import { parseHtml, getTitle } from "../parse/index.js";
import { findMainContent } from "../extract/index.js";
import { toSections, buildDocument } from "../format/index.js";

export function buildServer({ logger = true } = {}) {
  const app = Fastify({ logger });

  app.get("/health", async () => ({ ok: true }));

  app.get("/extract", async (req, reply) => {
    const { url } = req.query;
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

    try {
      const { html, finalUrl } = await fetchHtml(url);
      const $ = parseHtml(html);
      const title = getTitle($);
      const container = findMainContent($);
      if (!container) {
        return reply.code(422).send({ error: "no extractable content" });
      }
      const sections = toSections($, container);
      const doc = buildDocument({ url: finalUrl, title, sections });
      return doc;
    } catch (err) {
      if (err instanceof FetchError) {
        return reply.code(502).send({ error: err.message, url: err.url });
      }
      req.log.error(err);
      return reply.code(500).send({ error: "internal error" });
    }
  });

  return app;
}
