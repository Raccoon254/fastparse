// src/fetch/index.js
// Layer 1: simple HTTP fetch using undici. Returns the raw HTML.
// Layer 2 (smart retry, proxies) and Layer 3 (Playwright fallback) come later.

import { fetch } from "undici";

const DEFAULT_UA =
  "Mozilla/5.0 (compatible; fastparseBot/0.1; +https://github.com/Raccoon254/fastparse)";

const DEFAULT_TIMEOUT_MS = 15_000;

export class FetchError extends Error {
  constructor(message, { url, status, cause } = {}) {
    super(message);
    this.name = "FetchError";
    this.url = url;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

/**
 * Fetch a URL and return its HTML body.
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.userAgent]
 * @returns {Promise<{html: string, status: number, finalUrl: string, contentType: string}>}
 */
export async function fetchHtml(url, opts = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, userAgent = DEFAULT_UA } = opts;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent": userAgent,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: ac.signal,
    });
  } catch (cause) {
    clearTimeout(timer);
    throw new FetchError(`request failed: ${cause.message}`, { url, cause });
  }

  if (!res.ok) {
    clearTimeout(timer);
    throw new FetchError(`HTTP ${res.status}`, { url, status: res.status });
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType && !/html|xml/i.test(contentType)) {
    clearTimeout(timer);
    throw new FetchError(`unsupported content-type: ${contentType}`, {
      url,
      status: res.status,
    });
  }

  const html = await res.text();
  clearTimeout(timer);

  return {
    html,
    status: res.status,
    finalUrl: res.url || url,
    contentType,
  };
}
