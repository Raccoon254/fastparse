// src/config/index.js
//
// Central configuration. Defaults live here, environment variables override
// them, and explicit overrides passed at startup take precedence over both.
//
// Env vars:
//   FASTPARSE_STORAGE_ENABLED   "true" | "false"
//   FASTPARSE_STORAGE_DIR       absolute or relative path
//   FASTPARSE_STORAGE_FORMATS   comma-separated list of "json", "markdown"
//   FASTPARSE_PORT              integer
//   FASTPARSE_HOST              string
//   FASTPARSE_CACHE_MAX         integer
//   FASTPARSE_CACHE_TTL_MS      integer
//   FASTPARSE_LIMIT_CONCURRENCY integer
//   FASTPARSE_LIMIT_RPS         integer

export const DEFAULTS = Object.freeze({
  server: { host: "127.0.0.1", port: 3000 },
  storage: {
    enabled: true,
    dir: "./data",
    formats: ["json", "markdown"],
  },
  cache: { max: 500, ttlMs: 10 * 60 * 1000 },
  limit: { perHostConcurrency: 4, perHostRps: 4 },
});

/**
 * @param {object} [opts]
 * @param {object} [opts.env]        defaults to process.env
 * @param {object} [opts.overrides]  deep-merged on top of env-resolved values
 */
export function loadConfig({ env = process.env, overrides = {} } = {}) {
  const config = structuredClone(DEFAULTS);

  // server
  if (env.FASTPARSE_HOST) config.server.host = env.FASTPARSE_HOST;
  if (env.FASTPARSE_PORT !== undefined) {
    const n = Number(env.FASTPARSE_PORT);
    if (Number.isInteger(n) && n > 0) config.server.port = n;
  }

  // storage
  if (env.FASTPARSE_STORAGE_ENABLED !== undefined) {
    config.storage.enabled = env.FASTPARSE_STORAGE_ENABLED === "true";
  }
  if (env.FASTPARSE_STORAGE_DIR) {
    config.storage.dir = env.FASTPARSE_STORAGE_DIR;
  }
  if (env.FASTPARSE_STORAGE_FORMATS) {
    config.storage.formats = env.FASTPARSE_STORAGE_FORMATS
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // cache
  if (env.FASTPARSE_CACHE_MAX !== undefined) {
    const n = Number(env.FASTPARSE_CACHE_MAX);
    if (Number.isInteger(n) && n > 0) config.cache.max = n;
  }
  if (env.FASTPARSE_CACHE_TTL_MS !== undefined) {
    const n = Number(env.FASTPARSE_CACHE_TTL_MS);
    if (Number.isInteger(n) && n > 0) config.cache.ttlMs = n;
  }

  // limit
  if (env.FASTPARSE_LIMIT_CONCURRENCY !== undefined) {
    const n = Number(env.FASTPARSE_LIMIT_CONCURRENCY);
    if (Number.isInteger(n) && n > 0) config.limit.perHostConcurrency = n;
  }
  if (env.FASTPARSE_LIMIT_RPS !== undefined) {
    const n = Number(env.FASTPARSE_LIMIT_RPS);
    if (Number.isInteger(n) && n > 0) config.limit.perHostRps = n;
  }

  // explicit overrides win
  return deepMerge(config, overrides);
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    const sv = source[key];
    if (sv && typeof sv === "object" && !Array.isArray(sv)) {
      target[key] = deepMerge(target[key] ?? {}, sv);
    } else {
      target[key] = sv;
    }
  }
  return target;
}
