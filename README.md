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

> `pi install` automatically resolves npm dependencies (`defuddle`, `jsdom`) and registers two native tools: `web_search` and `web_fetch`.

## Tools

### `web_search`

Search the web using DuckDuckGo, Stack Overflow, npm, GitHub, Wikipedia, or a custom SearXNG instance. Jina is available via config but requires an API key. Context-aware routing (coding vs general), BM25 ranking, domain diversification, and provider-level result counts. Results cached 30 min.

**Parameters:**

- `query` (string) — Search query
- `max` (integer, default 10) — Max results (1–50)
- `context` (string, default "auto") — `"coding"`, `"general"`, or `"auto"`
- `noCache` (boolean, default false) — Skip cache

**Features:**

- Auto-detects coding vs general queries using multi-token pattern matching
- Runs providers sequentially by priority group, deduplicates results
- Applies corpus-level BM25 ranking within each priority group
- Diversifies results by domain (default 2 per domain)
- Reports per-provider status (ok/error/timeout) with result counts
- Supports partial results on abort

### `web_fetch`

Extract clean readable content from any URL. Uses Defuddle locally with Jina Reader fallback. Handles Cloudflare protection, SPAs, GitHub raw files, JSON, plain text, and binary content detection (PDF, images, archives). Includes SSRF protection. Cached 1 hour.

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

## Configuration

Optional settings go in `~/.pi/settings.json`:

```json
{
  "web-fetch": {
    "jinaEnabled": true,
    "min-delay": 1000,
    "max-delay": 3000,
    "cache-max-files": 100,
    "heading-threshold": 40000,
    "content-threshold": 32000,
    "jina-timeout": 30000,
    "max-response-size": 10485760
  },
  "web-search": {
    "default-context": "general",
    "contexts": {
      "coding": {
        "duckduckgo": { "priority": 1 },
        "stackoverflow": { "priority": 1 },
        "npm": { "priority": 1 },
        "github": { "priority": 1 },
        "ranking": true
      },
      "general": {
        "duckduckgo": { "priority": 1 },
        "wikipedia": { "priority": 1 },
        "ranking": true
      }
    }
  }
}
```

**web-search config options:**

| Option | Type | Description |
|--------|------|-------------|
| `default-context` | string | Default context when `context="auto"` (default: `"general"`) |
| `contexts` | object | Per-context provider chains with priorities |
| `contexts.<name>.ranking` | boolean | Enable BM25 ranking per context (default: `true`) |
| `contexts.<name>.searxng` | object | Custom SearXNG instance — requires `url` field |
| `contexts.<name>.searxng.priority: 0` | number | SearXNG-only mode (replaces default chain) |
| `api-key` | string | StackOverflow API key (optional) |
| `rate-limit-cooldowns` | object | Per-provider cooldown in seconds |
| `max-per-domain` | number | Max results per domain |

> **Note:** Jina is available as a provider but requires an API key. Add it manually via `contexts.general.jina` config if you have a Jina API key.

**web-fetch config options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `jinaEnabled` | boolean | `true` | Enable Jina Reader fallback |
| `min-delay` / `max-delay` | number | 1000 / 3000 | Politeness delay range (ms) |
| `cache-max-files` | number | 100 | Max cached files per directory |
| `heading-threshold` | number | 40000 | Heading size for smart truncation |
| `content-threshold` | number | 32000 | Max content size; oversize returns metadata only |
| `jina-timeout` | number | 30000 | Jina fallback timeout (ms) |
| `max-response-size` | number | 10485760 | Max response body size (bytes) |

## Requirements

- Node.js (ESM modules)
- Internet access

## License

MIT