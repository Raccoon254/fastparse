// src/cache/index.js
// Tiny wrapper around lru-cache so the rest of the code never imports it directly.

import { LRUCache } from "lru-cache";

const DEFAULT_MAX = 500;
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function createCache({ max = DEFAULT_MAX, ttlMs = DEFAULT_TTL_MS } = {}) {
  const lru = new LRUCache({ max, ttl: ttlMs });

  return {
    get(key) {
      return lru.get(key);
    },
    set(key, value) {
      lru.set(key, value);
      return value;
    },
    has(key) {
      return lru.has(key);
    },
    delete(key) {
      return lru.delete(key);
    },
    clear() {
      lru.clear();
    },
    get size() {
      return lru.size;
    },
  };
}
