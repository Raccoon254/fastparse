#!/usr/bin/env node
// fastparse — extract clean content from a web page.
// See `src/cli.js` for argv parsing and behaviour.

import { runCli } from "../src/cli.js";

const code = await runCli(process.argv.slice(2));
process.exit(code);
