// src/api/server.js
// Fastify HTTP server. The whole extraction pipeline lives in
// src/extract.js — this file is the thin HTTP shell over it.

import Fastify from "fastify";
import { createExtractor, ExtractError } from "../extract.js";

const ERROR_STATUS = {
  "invalid-url": 400,
  "invalid-format": 400,
  "invalid-mode": 400,
  "invalid-max": 400,
  "no-content": 422,
  "fetch-failed": 502,
};

export function buildServer({ logger = true, deps = {} } = {}) {
  const extractor = deps.extractor ?? createExtractor(deps);

  const app = Fastify({ logger });

  app.get("/health", async () => ({ ok: true }));

  app.get("/extract", async (req, reply) => {
    const { url, fresh, mode, max, format } = req.query;

    let maxSections;
    if (max !== undefined) {
      const n = Number(max);
      if (!Number.isInteger(n) || n <= 0) {
        return reply
          .code(400)
          .send({ error: "max must be a positive integer" });
      }
      maxSections = n;
    }

    try {
      const result = await extractor.extract(url, {
        format,
        mode,
        maxSections,
        fresh: fresh === "1" || fresh === "true",
      });
      const { cacheStatus, ...body } = result;
      reply.header("x-fastparse-cache", cacheStatus);
      return body;
    } catch (err) {
      if (err instanceof ExtractError) {
        const status = ERROR_STATUS[err.code] ?? 500;
        const payload = { error: err.message };
        if (status === 502) payload.url = err.url;
        return reply.code(status).send(payload);
      }
      req.log.error(err);
      return reply.code(500).send({ error: "internal error" });
    }
  });

  app.addHook("onClose", async () => {
    if (typeof extractor.renderer.close === "function") {
      await extractor.renderer.close();
    }
  });

  return app;
}
