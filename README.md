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

> `pi install` automatically resolves npm dependencies (`defuddle`, `jsdom`) and registers the six web tools plus the `web_tools` loader — the tools are lazy and stay inactive until activated via `web_tools` or `/web-tools`.

## Tools

### `search_ddg`

General web search via DuckDuckGo. Use for news, articles, broad topics, general queries, and as a fallback when no specialized tool fits — keep queries focused and short. Don't use for specific programming errors (→ `search_stackoverflow`).

**Parameters:**

- `query` (string) — Search query (any topic or phrase)
- `max` (integer, default 10, 1–50) — Max results to return
- `noCache` (boolean, default false) — Skip cache

### `search_wikipedia`

Encyclopedia knowledge via Wikipedia. Use for definitions, concepts, history — query with short topic names (e.g. "React (software)", "Kubernetes"), not full questions. Don't use for code errors (→ `search_stackoverflow`).

OpenSearch is prefix/title match — short topic names (e.g. "React (software)") work best; natural-language questions may return 0 results.

**Parameters:**

- `query` (string) — Short topic name (e.g. "React", "Kubernetes")
- `max` (integer, default 10, 1–50) — Max results to return
- `noCache` (boolean, default false) — Skip cache

### `search_stackoverflow`

Programming Q&A via Stack Overflow. Use for error messages, code patterns, debugging, syntax, API usage — include the full error message and code pattern. Don't use for package lookups (→ `search_npm`).

**Parameters:**

- `query` (string) — Error message or code pattern
- `max` (integer, default 10, 1–50) — Max results to return
- `noCache` (boolean, default false) — Skip cache

### `search_npm`

JavaScript package registry search. Use for package names, JS library functionality, dependency lookups — query short and specific (e.g. "react", "state machine"). Don't use for non-JS packages (pip, crates) (→ `search_ddg`).

**Parameters:**

- `query` (string) — Package name or functionality description
- `max` (integer, default 10, 1–50) — Max results to return
- `noCache` (boolean, default false) — Skip cache

### `search_github`

Repository and source code search via GitHub. Use for repo names, library names, code patterns, issues, docs — short names, not full sentences. Don't use for package docs (→ `search_npm`).

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

## Activation

The six web tools are **lazy**: registered at load but inactive until activated for the session. The model activates them via the always-active `web_tools` tool (purely additive — once enabled, all six stay active); users can force activation with `/web-tools`. Activation is per-session: a new session starts with the web tools hidden again.

For routing, query shaping, and zero-results recovery, load the `web-tools` skill (see Bundled Skills).

## Structure

```
henyo-pi-web/
├── package.json          # Extension manifest with pi entry point
├── index.ts              # Extension entry point (web tools, lazy web_tools loader, /web-tools, skills)
├── skills/
│   ├── deep-research/    # Multi-step autonomous research workflow with henyo-pi-web tools
│   │   └── references/   # Reference docs (evidence collection, source credibility, report templates)
│   └── web-tools/        # Routing + query shaping + zero-results protocol skill
├── shared/               # Shared utilities between tools
│   └── web-tools.ts      # Lazy activation core (WEB_TOOL_NAMES, hide/activate)
├── tests/                # Unit tests
├── vitest.config.ts      # Vitest test runner config
└── README.md
```

## Bundled Skills

### `/skill:deep-research`

A structured methodology for conducting deep, multi-step research — designed to work alongside henyo-pi-web's search and fetch tools. Guides the agent through planning, iterative retrieval, cross-source validation, and synthesis into a structured report with full citations. Use for complex research questions, competitive analysis, literature reviews, or any task requiring thorough investigation beyond a single search.

**Workflow:** Plan → Retrieve → Cross-Validate → Synthesize → Report

### `/skill:web-tools`

Routing and usage guide for the six web research tools: the tool routing matrix, query-shaping rules with good/bad examples, the zero-results protocol (rephrase shorter → next tool → report; cooldown and provider-error handling), fallback chains, and runtime behavior (30-min search cache, 1-hour fetch cache, `noCache`, oversized-fetch envelope). Load before a multi-query research pass or when a web search returns zero or weak results.

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