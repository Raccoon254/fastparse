# FastParse

[![test](https://github.com/Raccoon254/fastparse/actions/workflows/test.yml/badge.svg)](https://github.com/Raccoon254/fastparse/actions/workflows/test.yml)

A small HTTP service that fetches a web page and gives you back the actual content as JSON. No nav bars, no cookie banners, no footers — just the title, the headings, and the text underneath them.

It exists because feeding raw HTML (or even the raw text of a page) to an LLM is wasteful and noisy. fastparse is the layer in between.

Status: works on most static pages. JS-rendered sites and a token optimizer are next.

## Usage

```bash
git clone git@github.com:Raccoon254/fastparse.git
cd fastparse
npm install
npm run dev
```

Then hit it:

```bash
curl "http://127.0.0.1:3000/extract?url=https://en.wikipedia.org/wiki/Web_scraping"
```

You get back something like:

```json
{
  "title": "Web scraping - Wikipedia",
  "url": "https://en.wikipedia.org/wiki/Web_scraping",
  "sections": [
    { "heading": "History",    "content": "After the birth of the World Wide Web in 1989..." },
    { "heading": "Techniques", "content": "..." }
  ],
  "metadata": {
    "word_count": 3929,
    "section_count": 19,
    "extracted_at": "2026-04-09T10:12:15.236Z"
  }
}
```

There's also `GET /health` if you need a liveness check.

## How it works

```
url -> fetch -> parse -> clean -> score -> extract -> format -> json
```

1. **fetch** grabs the HTML over `undici` with a 15s timeout and follows redirects.
2. **parse** loads it into cheerio and rips out the obvious junk: scripts, styles, nav, footer, aside, forms, share buttons, cookie banners, anything matching `[role="navigation"]`, etc.
3. **score** walks every block-ish node and gives it points for text length, paragraph count, and prose-y signals (commas), and takes points away for link density and bad class/id hints (`sidebar`, `comments`, `promo`, …). `<article>` and `<main>` get a head start.
4. **extract** picks the highest scorer. There's a fast path: if the page has a meaty `<article>` or `<main>`, it just uses that.
5. **format** walks the winner in document order, splits on `h1-h6`, and emits a `{heading, content}[]` array.

That's the whole engine. Each step is one file under `src/`.

## Project layout

```
src/
  fetch/    undici GET, AbortController timeout, content-type guard
  parse/    cheerio load + noise stripping, title resolution
  score/    node scoring heuristics
  extract/  pick the winning container
  format/   walk the container into sections
  api/      Fastify server
  index.js  boot the server
```

## Tests

```bash
npm test                # everything
npm run test:unit       # pure functions, no network
npm run test:integration  # spins up local HTTP servers + Fastify inject()
npm run test:coverage   # all tests with V8 coverage
```

48 tests, 100% line / branch / function coverage on `src/`. CI runs lint → unit → integration → coverage gate → smoke (real HTTP boot) on Node 20 and 22.

## What's not here yet

- **Playwright fallback** for SPAs. Right now if a page is empty without JS, you get an empty page.
- **Token optimizer.** Dedup, merge tiny fragments, drop low-density blocks.
- **Intent extraction** (`?intent=pricing`). The plumbing is there, the logic isn't.
- **Caching.** Every request hits the network.
- **Real tests.** There's a CI smoke test that boots the server and hits `/extract`, but no unit tests yet.

## Stack

Node 20+, Fastify 5, undici 8, cheerio 1. ESM. No build step.

## License

MIT.
