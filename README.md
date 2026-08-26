# henyo-pi-web

Web search and content extraction tools for [Pi](https://github.com/earendil-works/pi).

**Henyo** means "genius" in Filipino — because Pi is sharp, and so are you.

## Install

**Ask your Pi agent:**

```
Install the henyo-pi-web npm package
```

Or run directly:

```bash
pi install npm:henyo-pi-web
```

> `pi install` automatically resolves npm dependencies (`defuddle`, `jsdom`) and registers five search tools and `henyo_fetch`.

## Tools

### `search_ddg`

General web search via DuckDuckGo. Query with any topic, question, or phrase. Use for news, articles, broad topics, and as a fallback when no specialized provider fits.

**Parameters:**

- `query` (string) — Search query (any topic or phrase)
- `max` (integer, default 10, 1–50) — Max results to return
- `noCache` (boolean, default false) — Skip cache

### `search_wikipedia`

Search Wikipedia for encyclopedia knowledge. Query with short topic names (e.g. "React", "Kubernetes", "Machine Learning"), not full questions. Use for definitions, concepts, history, and factual background.

OpenSearch is prefix/title match — short topic names (e.g. "React (software)") work best; natural-language questions may return 0 results.

**Parameters:**

- `query` (string) — Short topic name (e.g. "React", "Kubernetes")
- `max` (integer, default 10, 1–50) — Max results to return
- `noCache` (boolean, default false) — Skip cache

### `search_stackoverflow`

Search Stack Overflow for programming Q&A. Query with error messages, code patterns, or specific programming problems (e.g. "TypeError Cannot read properties of undefined"). Use for debugging, syntax, and API usage questions.

**Parameters:**

- `query` (string) — Error message or code pattern
- `max` (integer, default 10, 1–50) — Max results to return
- `noCache` (boolean, default false) — Skip cache

### `search_npm`

Search the npm registry for JavaScript packages. Query with package names or functionality descriptions (e.g. "state management", "date formatting"). Use when looking for libraries or dependencies.

**Parameters:**

- `query` (string) — Package name or functionality description
- `max` (integer, default 10, 1–50) — Max results to return
- `noCache` (boolean, default false) — Skip cache

### `search_github`

Search GitHub for repositories and source code. Query with repo names, library names, or code patterns (e.g. "react-router", "fastapi"). Use when looking for source code, issues, or documentation.

**Parameters:**

- `query` (string) — Repo name or code pattern
- `max` (integer, default 10, 1–50) — Max results to return
- `noCache` (boolean, default false) — Skip cache

### `henyo_fetch`

Extract clean readable content from any URL. Uses Defuddle-first extraction with Jina quality-check fallback. Handles Cloudflare protection, SPAs, GitHub raw files, JSON, plain text, and binary content detection (PDF, images, archives). Includes SSRF protection. Cached 1 hour.

**Parameters:**

- `url` (string) — URL to fetch
- `timeout` (integer, default 15000) — Timeout in ms (1000–60000)
- `noCache` (boolean, default false) — Skip cache
- `headers` (object, optional) — Custom HTTP headers, e.g. `{ "Authorization": "Bearer token" }`

**Features:**

- Content-type aware: handles HTML, JSON, plain text, and binary content
- Smart truncation with configurable heading/content thresholds
- Oversized content returns metadata only (URL, title, source, cache path)
- Politeness delay between requests (configurable min/max)
- Retry with exponential backoff
- `cached` flag on cached results
- Error categories in `details` (`errorCategory`: ssrf, invalid-url, timeout, not-found, forbidden, server-error, network, unknown)

**TUI Features:**

- **Source badges** — color-coded `[defuddle]`, `[jina]`, `[github]`, etc.
- **Size labels** — human-readable sizes (`12.3 KB`, `1.45 MB`)
- **Status indicators** — `[cached]`, `[truncated]`, `[oversized]` badges
- **Error cards** — categorized errors with actionable messages
- **Oversized content card** — structured metadata with guidance (reduce threshold, check cache, fresh fetch)
- **Collapsible content** — press expand key to view full content, collapse to return to header

## Structure

```
henyo-pi-web/
├── package.json          # Extension manifest with pi entry point
├── index.ts              # Extension entry point (registers five search tools + henyo_fetch)
├── skills/
│   └── deep-research/    # Multi-step autonomous research workflow with henyo-pi-web tools
│       └── references/   # Reference docs (evidence collection, source credibility, report templates)
├── shared/               # Shared utilities between tools
├── tests/                # Unit tests
├── vitest.config.ts      # Vitest test runner config
└── README.md
```

## Bundled Skills

### `/skill:deep-research`

A structured methodology for conducting deep, multi-step research — designed to work alongside henyo-pi-web's search and fetch tools. Guides the agent through planning, iterative retrieval, cross-source validation, and synthesis into a structured report with full citations. Use for complex research questions, competitive analysis, literature reviews, or any task requiring thorough investigation beyond a single search.

**Workflow:** Plan → Retrieve → Cross-Validate → Synthesize → Report

## Configuration

Optional settings go in `~/.pi/settings.json`:

```json
{
  "henyo-fetch": {
    "jinaEnabled": true,
    "min-delay": 1000,
    "max-delay": 3000,
    "cache-max-files": 100,
    "heading-threshold": 40000,
    "content-threshold": 32000,
    "jina-timeout": 30000,
    "max-response-size": 10485760
  },
  "henyo-search": {
    "trace": true,
    "providers": { "stackoverflow": { "api-key": "SO-KEY" } }
  }
}
```

**henyo-fetch config options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `jinaEnabled` | boolean | `true` | Enable Jina Reader fallback |
| `min-delay` / `max-delay` | number | 1000 / 3000 | Politeness delay range (ms) |
| `cache-max-files` | number | 100 | Max cached files per directory |
| `heading-threshold` | number | 40000 | Heading size for smart truncation |
| `content-threshold` | number | 32000 | Max content size; oversize returns metadata only |
| `jina-timeout` | number | 30000 | Jina fallback timeout (ms) |
| `max-response-size` | number | 10485760 | Max response body size (bytes) |

**henyo-search config options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `trace` | boolean \| string[] | none | Pipeline debug tracing: `true` traces all providers, a list of provider names traces only those. Logs to `/tmp/henyo-trace.log` with rotation. |
| `providers.<name>.api-key` | string | none | Per-provider API key — currently `stackoverflow` only. An SO StackExchange key raises the SO API quota from the shared anonymous limit to the per-user quota. |

Per-provider blocks live under `providers`, keyed by provider name (`stackoverflow`, `duckduckgo`, `wikipedia`, `npm`, `github`) — provider names are reserved.

**Tool contract:** each search tool returns only its own provider's results. A provider failure surfaces as `Provider error (…)` or `Search cooling down …`, never as another provider's results; a genuine no-matches query returns 0 results. Rate-limit cooldowns (built-in per-provider defaults) are enforced and reported, not swallowed.

## Requirements

- Node.js (ESM modules)
- Internet access

## License

MIT