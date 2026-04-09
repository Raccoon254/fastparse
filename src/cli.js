// src/cli.js
//
// fastparse command-line entry point. The shebang script in bin/ just
// calls runCli(process.argv.slice(2)). Everything is exposed as a
// function so it can be unit-tested with synthetic argv and writable
// stream stubs.

import { parseArgs } from "node:util";
import { createExtractor, ExtractError } from "./extract.js";
import { loadConfig } from "./config/index.js";
import { createCache } from "./cache/index.js";
import { createLimiter } from "./limit/index.js";
import { createStorage } from "./storage/index.js";

const HELP = `Usage: fastparse <url> [options]

Extract clean content from a web page as JSON or markdown.

Options:
  --format <json|markdown>   output format (default: json)
  --mode <full|summary>      keep everything or just the longest sections
  --max <N>                  in summary mode, keep top N sections
  --fresh                    bypass the in-memory cache
  --raw                      print only the markdown content (markdown only)
  --quiet                    extract and archive but print nothing
  -h, --help                 show this help

Environment:
  FASTPARSE_STORAGE_DIR      where to write the archive (default: ./data)
  FASTPARSE_STORAGE_ENABLED  set to "false" to disable disk archiving
  FASTPARSE_STORAGE_FORMATS  comma-separated list (default: json,markdown)

Examples:
  fastparse https://example.com/article
  fastparse https://example.com/article --format markdown --raw > article.md
  fastparse https://example.com/article --mode summary --max 3
`;

/**
 * @param {string[]} argv  process.argv.slice(2)
 * @param {object} [io]
 * @param {NodeJS.WritableStream} [io.stdout]
 * @param {NodeJS.WritableStream} [io.stderr]
 * @param {(deps: object) => object} [io.makeExtractor]  injection seam for tests
 * @returns {Promise<number>} exit code
 */
export async function runCli(
  argv,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    makeExtractor = defaultMakeExtractor,
  } = {},
) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        format: { type: "string", default: "json" },
        mode: { type: "string", default: "full" },
        max: { type: "string" },
        fresh: { type: "boolean", default: false },
        raw: { type: "boolean", default: false },
        quiet: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (err) {
    stderr.write(`fastparse: ${err.message}\n`);
    return 2;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    stdout.write(HELP);
    return 0;
  }

  if (positionals.length === 0) {
    stderr.write(HELP);
    return 1;
  }

  if (positionals.length > 1) {
    stderr.write(`fastparse: expected exactly one URL, got ${positionals.length}\n`);
    return 2;
  }

  const url = positionals[0];
  let maxSections;
  if (values.max !== undefined) {
    const n = Number(values.max);
    if (!Number.isInteger(n) || n <= 0) {
      stderr.write(`fastparse: --max must be a positive integer, got ${values.max}\n`);
      return 2;
    }
    maxSections = n;
  }

  const extractor = makeExtractor();
  const code = await runOnce(extractor, url, values, maxSections, stdout, stderr);
  if (typeof extractor.renderer.close === "function") {
    await extractor.renderer.close();
  }
  return code;
}

async function runOnce(extractor, url, values, maxSections, stdout, stderr) {
  let result;
  try {
    result = await extractor.extract(url, {
      format: values.format,
      mode: values.mode,
      maxSections,
      fresh: values.fresh,
    });
  } catch (err) {
    if (err instanceof ExtractError) {
      stderr.write(`fastparse: ${err.message}\n`);
      return 1;
    }
    stderr.write(`fastparse: ${err.stack ?? err.message}\n`);
    return 1;
  }

  if (values.quiet) {
    return 0;
  }

  if (values.raw) {
    if (values.format !== "markdown") {
      stderr.write("fastparse: --raw requires --format markdown\n");
      return 2;
    }
    stdout.write(result.content);
    stdout.write("\n");
    return 0;
  }

  const { cacheStatus: _cs, ...body } = result;
  stdout.write(JSON.stringify(body, null, 2));
  stdout.write("\n");
  return 0;
}

function defaultMakeExtractor() {
  const config = loadConfig();
  return createExtractor({
    cache: createCache(config.cache),
    limiter: createLimiter(config.limit),
    storage: createStorage(config.storage),
  });
}
