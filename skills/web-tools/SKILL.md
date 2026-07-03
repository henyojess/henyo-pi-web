---
name: web-tools
description: Web search and content extraction. Search the web and fetch URL content via CLI scripts. Use when you need to find information on the internet or retrieve page content.
license: MIT
compatibility: Requires Node.js (ESM) and internet access. Installs `defuddle` and `jsdom` via npm.
---

# Web Tools

Search the web and fetch page content.

## Setup

Check if setup is needed:
```bash
command -v web_search >/dev/null 2>&1 && echo "ready" || echo "needs setup"
```
If it says "needs setup", see [setup.md](setup.md).

## Web Search

```bash
web_search query "<query>" [--max N] [--no-cache] [--context coding|general] [--text]
```

Returns a JSON array of `{title, url, snippet, source}` objects.

### Use pattern
```bash
web_search query "how to handle errors in React useEffect" --max 5
```

## Web Fetch

```bash
web_fetch url "<url>" [--format text|markdown|json|raw] [--no-cache] [--raw] [--quiet] [--short] [--timeout ms]
```

### Format options
- **text** (default): Structured output with URL/Title/Source headers
- **json**: `{url, title, content, source, truncated}` object
- **raw**: Unprocessed HTML/text, no extraction
- **markdown**: Same as text

## Error handling
- Search returns `[]` (empty array) on failure, never null
- Fetch returns raw HTML as fallback when all extraction fails