// src/storage/index.js
//
// Persist extracted documents to disk. Each successful extraction is
// archived under:
//
//   {dir}/{host}/{path-segments}/{timestamp}.{json|markdown}
//
// e.g. data/axene.io/about/2026-04-09T11-30-00-000Z.json
//
// Filenames and path segments are sanitized so a malicious URL can't
// escape the storage dir. Failures are surfaced to the caller via a
// rejected promise — the API layer logs and swallows them so a disk
// problem never breaks an extraction response.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_FORMATS = ["json", "markdown"];

const EXT = {
  json: "json",
  markdown: "markdown",
};

/**
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=false]   off by default for safety
 * @param {string}  [opts.dir="./data"]
 * @param {string[]} [opts.formats=["json","markdown"]]
 * @param {(p: string, opts?: any) => Promise<any>} [opts.mkdir] for tests
 * @param {(p: string, data: any) => Promise<any>} [opts.writeFile] for tests
 */
export function createStorage({
  enabled = false,
  dir = "./data",
  formats = DEFAULT_FORMATS,
  mkdir: mkdirImpl = mkdir,
  writeFile: writeFileImpl = writeFile,
} = {}) {
  if (!enabled) {
    return {
      enabled: false,
      dir,
      formats,
      async save() {
        return null;
      },
    };
  }

  return {
    enabled: true,
    dir,
    formats,

    /**
     * @param {object} args
     * @param {string} args.url       the original URL being archived
     * @param {object} [args.json]    full JSON document (will be JSON.stringified)
     * @param {string} [args.markdown] full markdown string
     * @returns {Promise<{dir: string, written: string[]}>}
     */
    async save({ url, json, markdown }) {
      const subdir = urlToSubdir(url);
      const targetDir = path.join(dir, subdir);
      await mkdirImpl(targetDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const written = [];

      if (formats.includes("json") && json) {
        const file = path.join(targetDir, `${timestamp}.${EXT.json}`);
        await writeFileImpl(file, JSON.stringify(json, null, 2));
        written.push(file);
      }
      if (formats.includes("markdown") && markdown) {
        const file = path.join(targetDir, `${timestamp}.${EXT.markdown}`);
        await writeFileImpl(file, markdown);
        written.push(file);
      }

      return { dir: targetDir, written };
    },
  };
}

/**
 * Build the on-disk subdirectory for a given URL. The host and each path
 * segment are sanitized to a conservative character set so a hostile URL
 * can't escape the storage root or smuggle in shell-unfriendly names.
 */
export function urlToSubdir(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "_invalid";
  }

  const host = sanitizeSegment(parsed.host) || "_unknown";
  const segments = parsed.pathname
    .split("/")
    .map(sanitizeSegment)
    .filter(Boolean);

  return path.join(host, ...segments);
}

function sanitizeSegment(s) {
  if (!s) return "";
  // Allow letters, digits, dot, dash, underscore. Anything else (slashes,
  // dot-dot, query chars, colons) becomes an underscore so we never write
  // outside the storage root.
  const cleaned = s.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Strip leading dots so we don't accidentally create dotfiles or escape.
  return cleaned.replace(/^\.+/, "_");
}
