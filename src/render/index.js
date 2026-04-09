// src/render/index.js
// Headless-browser fallback for SPA pages.
//
// Playwright is an optional dependency. We never import it eagerly — the
// loader is called the first time render() is invoked, and tests can pass
// in a fake `loadChromium` to exercise the orchestration without launching
// a real browser.

const DEFAULT_UA =
  "Mozilla/5.0 (compatible; fastparseBot/0.1; +https://github.com/Raccoon254/fastparse)";

const DEFAULT_TIMEOUT_MS = 30_000;

export async function defaultLoadChromium() {
  const pw = await import("playwright");
  return pw.chromium;
}

/**
 * Build a renderer that lazily launches one shared chromium browser and
 * reuses it across calls.
 *
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {() => Promise<object>} [opts.loadChromium]  injection seam for tests
 */
export function createRenderer({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  loadChromium = defaultLoadChromium,
} = {}) {
  let browserPromise = null;

  async function getBrowser() {
    if (!browserPromise) {
      const chromium = await loadChromium();
      browserPromise = chromium.launch({ headless: true });
    }
    return browserPromise;
  }

  return {
    async render(url, opts = {}) {
      const browser = await getBrowser();
      const context = await browser.newContext({ userAgent: DEFAULT_UA });
      const page = await context.newPage();
      try {
        await page.goto(url, {
          waitUntil: "networkidle",
          timeout: opts.timeoutMs ?? timeoutMs,
        });
        const html = await page.content();
        return {
          html,
          finalUrl: page.url(),
          status: 200,
          contentType: "text/html",
          rendered: true,
        };
      } finally {
        await context.close();
      }
    },

    async close() {
      if (browserPromise) {
        const b = await browserPromise;
        await b.close();
        browserPromise = null;
      }
    },
  };
}
