import { test } from "node:test";
import assert from "node:assert/strict";
import { runCli } from "../../src/cli.js";
import { ExtractError } from "../../src/extract.js";

// Tiny writable-stream stub that captures everything written to it.
function captureStream() {
  const chunks = [];
  return {
    write(s) {
      chunks.push(String(s));
      return true;
    },
    get text() {
      return chunks.join("");
    },
  };
}

const happyDoc = {
  title: "Sample",
  url: "http://x.test/",
  sections: [{ heading: "S", content: "hello world" }],
  metadata: { word_count: 2, section_count: 1, mode: "full", format: "json" },
  cacheStatus: "miss",
};

const happyMarkdownDoc = {
  title: "Sample",
  url: "http://x.test/",
  content: "# Sample\n\nhello world",
  metadata: { word_count: 3, section_count: 1, mode: "full", format: "markdown" },
  cacheStatus: "miss",
};

function makeStubExtractor(behaviour = {}) {
  return () => ({
    extract: async (url, opts) => {
      if (behaviour.throw) throw behaviour.throw;
      if (opts?.format === "markdown") return { ...happyMarkdownDoc };
      return { ...happyDoc };
    },
    renderer: { close: async () => {} },
  });
}

test("runCli prints help and exits 0 on --help", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await runCli(["--help"], { stdout, stderr, makeExtractor: makeStubExtractor() });
  assert.equal(code, 0);
  assert.match(stdout.text, /Usage: fastparse/);
});

test("runCli prints help to stderr and exits 1 when no url is given", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await runCli([], { stdout, stderr, makeExtractor: makeStubExtractor() });
  assert.equal(code, 1);
  assert.match(stderr.text, /Usage: fastparse/);
});

test("runCli rejects more than one positional with exit 2", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await runCli(
    ["http://a.test/", "http://b.test/"],
    { stdout, stderr, makeExtractor: makeStubExtractor() },
  );
  assert.equal(code, 2);
  assert.match(stderr.text, /expected exactly one URL/);
});

test("runCli prints JSON by default", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await runCli(["http://x.test/"], {
    stdout,
    stderr,
    makeExtractor: makeStubExtractor(),
  });
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout.text);
  assert.equal(parsed.title, "Sample");
  assert.equal(parsed.cacheStatus, undefined, "cacheStatus should be stripped from output");
});

test("runCli prints raw markdown with --raw --format markdown", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await runCli(
    ["http://x.test/", "--format", "markdown", "--raw"],
    { stdout, stderr, makeExtractor: makeStubExtractor() },
  );
  assert.equal(code, 0);
  assert.equal(stdout.text.trim(), "# Sample\n\nhello world".trim());
});

test("runCli rejects --raw without markdown format", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await runCli(["http://x.test/", "--raw"], {
    stdout,
    stderr,
    makeExtractor: makeStubExtractor(),
  });
  assert.equal(code, 2);
  assert.match(stderr.text, /--raw requires --format markdown/);
});

test("runCli prints nothing when --quiet", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await runCli(["http://x.test/", "--quiet"], {
    stdout,
    stderr,
    makeExtractor: makeStubExtractor(),
  });
  assert.equal(code, 0);
  assert.equal(stdout.text, "");
});

test("runCli rejects invalid --max with exit 2", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await runCli(
    ["http://x.test/", "--max", "abc"],
    { stdout, stderr, makeExtractor: makeStubExtractor() },
  );
  assert.equal(code, 2);
  assert.match(stderr.text, /--max must be a positive integer/);
});

test("runCli accepts a numeric --max", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await runCli(
    ["http://x.test/", "--mode", "summary", "--max", "3"],
    { stdout, stderr, makeExtractor: makeStubExtractor() },
  );
  assert.equal(code, 0);
});

test("runCli prints ExtractError message and exits 1", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await runCli(["http://x.test/"], {
    stdout,
    stderr,
    makeExtractor: makeStubExtractor({
      throw: new ExtractError("fetch-failed", "HTTP 404", {
        url: "http://x.test/",
        status: 404,
      }),
    }),
  });
  assert.equal(code, 1);
  assert.match(stderr.text, /HTTP 404/);
});

test("runCli prints unexpected errors with stack and exits 1", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await runCli(["http://x.test/"], {
    stdout,
    stderr,
    makeExtractor: makeStubExtractor({ throw: new Error("kaboom") }),
  });
  assert.equal(code, 1);
  assert.match(stderr.text, /kaboom/);
});

test("runCli falls back to err.message when no stack is available", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  // Throw a plain object without a stack property.
  const code = await runCli(["http://x.test/"], {
    stdout,
    stderr,
    makeExtractor: makeStubExtractor({
      throw: { message: "stackless error" },
    }),
  });
  assert.equal(code, 1);
  assert.match(stderr.text, /stackless error/);
});

test("runCli surfaces parseArgs errors with exit 2", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await runCli(["http://x.test/", "--unknown"], {
    stdout,
    stderr,
    makeExtractor: makeStubExtractor(),
  });
  assert.equal(code, 2);
  assert.match(stderr.text, /fastparse:/);
});

test("runCli closes the renderer when one is present", async () => {
  let closed = false;
  const stdout = captureStream();
  const stderr = captureStream();
  await runCli(["http://x.test/"], {
    stdout,
    stderr,
    makeExtractor: () => ({
      extract: async () => ({ ...happyDoc }),
      renderer: {
        close: async () => {
          closed = true;
        },
      },
    }),
  });
  assert.equal(closed, true);
});

test("runCli tolerates an extractor without a renderer.close", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await runCli(["http://x.test/"], {
    stdout,
    stderr,
    makeExtractor: () => ({
      extract: async () => ({ ...happyDoc }),
      renderer: {},
    }),
  });
  assert.equal(code, 0);
});


test("runCli with default makeExtractor builds a real extractor", async () => {
  // Just verify the default factory wires up without crashing. We pass an
  // invalid url so we exit early before hitting the network.
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await runCli(["not-a-url"], { stdout, stderr });
  assert.equal(code, 1);
  assert.match(stderr.text, /invalid url/);
});
