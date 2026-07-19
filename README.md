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

Search the web using DuckDuckGo, Stack Overflow, npm, GitHub, Wikipedia, or Jina. Context-aware routing (coding vs general). Results cached 30 min.

**Parameters:**

- `query` (string) — Search query
- `max` (integer, default 10) — Max results (1–50)
- `context` (string, default "auto") — `"coding"`, `"general"`, or `"auto"`
- `noCache` (boolean, default false) — Skip cache

### `web_fetch`

Extract clean readable content from any URL. Uses Defuddle locally with Jina Reader fallback. Handles Cloudflare protection, SPAs, GitHub raw files. Cached 1 hour.

**Parameters:**

- `url` (string) — URL to fetch
- `timeout` (integer, default 15000) — Timeout in ms (1000–60000)
- `noCache` (boolean, default false) — Skip cache
- `headers` (object, optional) — Custom HTTP headers, e.g. `{ "Authorization": "Bearer token" }`

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
        "github": { "priority": 1 }
      },
      "general": {
        "duckduckgo": { "priority": 1 },
        "wikipedia": { "priority": 1 },
        "jina": { "priority": 2 }
      }
    }
  }
}
```

## Requirements

- Node.js (ESM modules)
- Internet access

## License

MIT