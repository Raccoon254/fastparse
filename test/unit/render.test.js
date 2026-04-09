import { test } from "node:test";
import assert from "node:assert/strict";
import { createRenderer, defaultLoadChromium } from "../../src/render/index.js";

// Build a fake chromium that records every call so tests can assert on
// orchestration without launching a real browser.
function makeFakeChromium({ pageHtml = "<html><body>rendered</body></html>", finalUrl = "http://x.test/", failOnGoto = false } = {}) {
  const calls = { launch: 0, newContext: 0, newPage: 0, goto: 0, content: 0, contextClose: 0, browserClose: 0 };
  let lastGotoOpts = null;
  let lastContextOpts = null;

  const browser = {
    async newContext(opts) {
      calls.newContext++;
      lastContextOpts = opts;
      return {
        async newPage() {
          calls.newPage++;
          return {
            async goto(_url, opts) {
              calls.goto++;
              lastGotoOpts = opts;
              if (failOnGoto) throw new Error("goto failed");
            },
            async content() {
              calls.content++;
              return pageHtml;
            },
            url() {
              return finalUrl;
            },
          };
        },
        async close() {
          calls.contextClose++;
        },
      };
    },
    async close() {
      calls.browserClose++;
    },
  };

  return {
    chromium: {
      async launch(opts) {
        calls.launch++;
        // sanity: respect headless option
        assert.equal(opts.headless, true);
        return browser;
      },
    },
    calls,
    get lastGotoOpts() { return lastGotoOpts; },
    get lastContextOpts() { return lastContextOpts; },
  };
}

test("renderer.render returns rendered html and uses default options", async () => {
  const fake = makeFakeChromium();
  const r = createRenderer({ loadChromium: async () => fake.chromium });

  const out = await r.render("http://spa.test/");

  assert.equal(out.html, "<html><body>rendered</body></html>");
  assert.equal(out.finalUrl, "http://x.test/");
  assert.equal(out.status, 200);
  assert.equal(out.contentType, "text/html");
  assert.equal(out.rendered, true);
  assert.equal(fake.calls.launch, 1);
  assert.equal(fake.calls.goto, 1);
  assert.equal(fake.lastGotoOpts.waitUntil, "networkidle");
  assert.equal(fake.lastGotoOpts.timeout, 30_000);
  assert.match(fake.lastContextOpts.userAgent, /fastparseBot/);

  await r.close();
});

test("renderer.render reuses the same browser across calls", async () => {
  const fake = makeFakeChromium();
  const r = createRenderer({ loadChromium: async () => fake.chromium });

  await r.render("http://a.test/");
  await r.render("http://b.test/");
  await r.render("http://c.test/");

  assert.equal(fake.calls.launch, 1, "browser should be launched once");
  assert.equal(fake.calls.goto, 3);
  assert.equal(fake.calls.contextClose, 3, "every context closes after use");

  await r.close();
});

test("renderer.render honours an explicit per-call timeoutMs", async () => {
  const fake = makeFakeChromium();
  const r = createRenderer({
    loadChromium: async () => fake.chromium,
    timeoutMs: 5_000,
  });

  await r.render("http://x.test/", { timeoutMs: 1234 });
  assert.equal(fake.lastGotoOpts.timeout, 1234);

  await r.render("http://x.test/");
  assert.equal(fake.lastGotoOpts.timeout, 5_000);

  await r.close();
});

test("renderer.render closes the context even if goto throws", async () => {
  const fake = makeFakeChromium({ failOnGoto: true });
  const r = createRenderer({ loadChromium: async () => fake.chromium });

  await assert.rejects(() => r.render("http://x.test/"), /goto failed/);
  assert.equal(fake.calls.contextClose, 1);

  await r.close();
});

test("renderer.close shuts down the browser and is idempotent", async () => {
  const fake = makeFakeChromium();
  const r = createRenderer({ loadChromium: async () => fake.chromium });

  // close() before any render is a no-op
  await r.close();
  assert.equal(fake.calls.browserClose, 0);

  await r.render("http://x.test/");
  await r.close();
  assert.equal(fake.calls.browserClose, 1);

  // After close, render() can lazily relaunch.
  await r.render("http://x.test/");
  assert.equal(fake.calls.launch, 2);

  await r.close();
});

test("defaultLoadChromium imports playwright lazily", async () => {
  const chromium = await defaultLoadChromium();
  assert.ok(chromium, "should return the chromium namespace");
  assert.equal(typeof chromium.launch, "function");
});

test("renderer surfaces loadChromium failure", async () => {
  const r = createRenderer({
    loadChromium: async () => {
      throw new Error("playwright missing");
    },
  });
  await assert.rejects(() => r.render("http://x.test/"), /playwright missing/);
});
