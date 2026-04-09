// fastparse entrypoint.

import { buildServer } from "./api/server.js";
import { loadConfig } from "./config/index.js";
import { createCache } from "./cache/index.js";
import { createLimiter } from "./limit/index.js";
import { createStorage } from "./storage/index.js";

const config = loadConfig();

const app = buildServer({
  deps: {
    cache: createCache(config.cache),
    limiter: createLimiter(config.limit),
    storage: createStorage(config.storage),
  },
});

app
  .listen({ port: config.server.port, host: config.server.host })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
