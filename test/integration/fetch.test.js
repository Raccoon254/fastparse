import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetchHtml, FetchError } from "../../src/fetch/index.js";

let server;
let baseUrl;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === "/ok") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body><p>hello</p></body></html>");
      return;
    }
    if (req.url === "/json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"not":"html"}');
      return;
    }
    if (req.url === "/missing") {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<html><body>404</body></html>");
      return;
    }
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/ok" });
      res.end();
      return;
    }
    if (req.url === "/no-ctype") {
      // Deliberately omit content-type.
      res.writeHead(200);
      res.end("<html><body><p>no ctype</p></body></html>");
      return;
    }
    if (req.url === "/slow") {
      // Hold the connection open longer than the test's timeout.
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><body><p>slow</p></body></html>");
      }, 2000);
      return;
    }
    res.writeHead(500);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
});

test("fetchHtml returns html and 200", async () => {
  const res = await fetchHtml(`${baseUrl}/ok`);
  assert.equal(res.status, 200);
  assert.match(res.html, /hello/);
  assert.match(res.contentType, /text\/html/);
});

test("fetchHtml follows redirects", async () => {
  const res = await fetchHtml(`${baseUrl}/redirect`);
  assert.equal(res.status, 200);
  assert.match(res.html, /hello/);
});

test("fetchHtml throws FetchError on HTTP 404", async () => {
  await assert.rejects(
    () => fetchHtml(`${baseUrl}/missing`),
    (err) => {
      assert.ok(err instanceof FetchError);
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test("fetchHtml rejects non-html content types", async () => {
  await assert.rejects(
    () => fetchHtml(`${baseUrl}/json`),
    (err) => {
      assert.ok(err instanceof FetchError);
      assert.match(err.message, /unsupported content-type/);
      return true;
    },
  );
});

test("fetchHtml throws on connection refused", async () => {
  await assert.rejects(
    () => fetchHtml("http://127.0.0.1:1/nope"),
    (err) => err instanceof FetchError,
  );
});

test("fetchHtml sends a custom user-agent when provided", async () => {
  let receivedUa;
  const captureServer = createServer((req, res) => {
    receivedUa = req.headers["user-agent"];
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body><p>ok</p></body></html>");
  });
  await new Promise((r) => captureServer.listen(0, "127.0.0.1", r));
  try {
    const { port } = captureServer.address();
    await fetchHtml(`http://127.0.0.1:${port}/`, { userAgent: "MyBot/9.9" });
    assert.equal(receivedUa, "MyBot/9.9");
  } finally {
    await new Promise((r) => captureServer.close(r));
  }
});

test("fetchHtml accepts responses with no content-type header", async () => {
  const res = await fetchHtml(`${baseUrl}/no-ctype`);
  assert.equal(res.status, 200);
  assert.match(res.html, /no ctype/);
});

test("fetchHtml aborts and throws when the request exceeds timeoutMs", async () => {
  await assert.rejects(
    () => fetchHtml(`${baseUrl}/slow`, { timeoutMs: 100 }),
    (err) => {
      assert.ok(err instanceof FetchError);
      assert.match(err.message, /request failed/);
      return true;
    },
  );
});
