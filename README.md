# fastparse

> AI-optimized web content extraction engine — turns raw HTML into clean, structured, token-efficient JSON for LLMs and RAG pipelines.

**Status:** early scaffold (WIP). The API and extraction pipeline are not implemented yet.

---

## Why

Modern AI systems pull a lot of context from the open web, but most web content is hostile to LLMs:

- **Too much noise** — nav bars, ads, scripts, footers, cookie banners.
- **Too many tokens** — passing raw HTML or even raw text to an LLM is expensive and slow.
- **No structure** — naive extraction throws away headings, sections, and semantic hierarchy.
- **No intent** — existing scrapers can't say "just give me the pricing" or "just give me the contact info".
- **Per-site tuning** — most tools need custom selectors for every domain.

`fastparse` exists to fix that. It fetches a page, strips the junk, ranks what's left, and returns a structured, token-efficient JSON document an LLM can actually use.

## Features (planned)

- **DOM-based cleanup** — remove `<script>`, `<style>`, `<nav>`, `<footer>`, `<aside>` and other non-content nodes.
- **Content scoring** — rank blocks by text length, text/HTML ratio, link density, and heading proximity.
- **Structured JSON output** — `title`, `url`, `sections[{ heading, content }]`, `metadata`.
- **Token optimization** — dedupe, merge fragments, drop low-density blocks.
- **Intent-based extraction** — `?intent=pricing`, `?intent=contact`, `?intent=specs`.
- **JS rendering fallback** — Playwright kicks in only when plain fetch returns thin or empty content.
- **Simple HTTP API** — `GET /extract?url=…&mode=…&intent=…`.

## Architecture

```
URL → Fetcher → Renderer? → Parser → Cleaner → Extractor → Scorer → Formatter → Optimizer → JSON
```

Each stage lives in its own module under `src/`:

```
src/
  fetch/      # Layer 1 native fetch + Layer 2 smart client (undici)
  parse/      # cheerio-based DOM parsing
  extract/    # candidate content block selection
  score/      # text/link density scoring
  format/     # structured JSON output
  optimize/   # token reduction + dedup
  api/        # Fastify route handlers
  index.js    # entrypoint
```

## Quickstart (WIP — not wired up yet)

```bash
npm install
npm run dev
# then:
curl "http://localhost:3000/extract?url=https://example.com"
```

Example response shape:

```json
{
  "title": "Page Title",
  "url": "https://example.com",
  "sections": [
    { "heading": "Introduction", "content": "..." },
    { "heading": "Details", "content": "..." }
  ],
  "metadata": {
    "word_count": 1200,
    "extracted_at": "2026-04-09T12:00:00Z"
  }
}
```

## Roadmap

**v1 — Node MVP**
- [ ] Native `fetch` + `undici` smart client
- [ ] Cheerio parsing + DOM cleanup
- [ ] Content scoring algorithm
- [ ] Structured JSON formatter
- [ ] Fastify `/extract` endpoint

**v1.1 — JS rendering**
- [ ] Playwright fallback when fetch returns thin content
- [ ] Per-domain caching

**v1.2 — Token optimization**
- [ ] Dedup + low-density block pruning
- [ ] `mode=summary`

**v2 — Performance**
- [ ] Rewrite hot extraction path in Go
- [ ] Keep Node as the rendering + API layer

**v3 — AI layer (optional)**
- [ ] Python sidecar for embeddings, summarization, intent classification

## Stack

- **Runtime:** Node.js ≥ 20 (ESM)
- **HTTP:** native `fetch`, `undici`
- **Parsing:** `cheerio`
- **Rendering fallback:** `playwright`
- **API:** `fastify`

## License

MIT
