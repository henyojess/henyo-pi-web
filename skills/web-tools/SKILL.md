---
name: web-tools
description: Web search and content extraction. Search the web and fetch URL content via CLI scripts. Use when you need to find information on the internet or retrieve page content.
license: MIT
compatibility: Requires Node.js (ESM) and internet access. Installs `defuddle` and `jsdom` via npm.
---

# Web Tools

Search the web and fetch page content.

## One-time Setup

When the user asks to install this skill (after the package is installed), run these steps:

### Step 1: Make scripts available on PATH

Create symlinks so the agent can call `web_search` and `web_fetch` as global commands. **Only create them if they don't already exist** — skip silently if the link is already in place. Adapt the path to match the install source:

```bash
# npm install — predictable path
[ -L ~/.pi/agent/bin/web_search ] || ln -sf ~/.pi/agent/npm/henyo-pi-web/skills/web-tools/web_search.js ~/.pi/agent/bin/web_search
[ -L ~/.pi/agent/bin/web_fetch ] || ln -sf ~/.pi/agent/npm/henyo-pi-web/skills/web-tools/web_fetch.js ~/.pi/agent/bin/web_fetch

# git install — predictable path
[ -L ~/.pi/agent/bin/web_search ] || ln -sf ~/.pi/agent/git/github.com/user/henyo-pi-web/skills/web-tools/web_search.js ~/.pi/agent/bin/web_search
[ -L ~/.pi/agent/bin/web_fetch ] || ln -sf ~/.pi/agent/git/github.com/user/henyo-pi-web/skills/web-tools/web_fetch.js ~/.pi/agent/bin/web_fetch

# local install — discover dynamically
SEARCH_FILE=$(find /path/to/henyo-pi-web -name web_search.js -type f 2>/dev/null | head -1)
FETCH_FILE=$(find /path/to/henyo-pi-web -name web_fetch.js -type f 2>/dev/null | head -1)
[ -L ~/.pi/agent/bin/web_search ] || ln -sf "$SEARCH_FILE" ~/.pi/agent/bin/web_search
[ -L ~/.pi/agent/bin/web_fetch ] || ln -sf "$FETCH_FILE" ~/.pi/agent/bin/web_fetch
```

### Step 3: Verify

```bash
web_search --help 2>&1 | head -2
```

## Web Search

```bash
web_search query "<query>" [--max N] [--no-cache] [--context coding|general] [--text]
```

Returns a JSON array of `{title, url, snippet, source}` objects.

### Contexts
- **coding** (auto-detected): DuckDuckGo + Stack Overflow + npm registry + GitHub repos
- **general** (auto-detected): DuckDuckGo + Wikipedia + Jina Search
- Auto-detects from 2+ coding signals in query: `Error:`, `import`, `const`, `async`, `npm`, `pip`, `cargo`, `Dockerfile`, `git`, etc.

### Use pattern
```bash
web_search query "how to handle errors in React useEffect" --max 5
web_fetch url "https://example.com/article" --format json
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

### Smart features
- GitHub URLs (`/owner/repo/blob/ref/path`) → auto-fetched via GitHub raw API
- JSON endpoints → pretty-printed JSON
- Bot protection (Cloudflare, CAPTCHA) → Jina Reader directly
- Defuddle failure → Jina Reader → raw HTML fallback
- HTTP 429/500/502/503/504 → retry with exponential backoff (3 attempts)
- Truncated at 40,000 chars at heading boundary with remaining-heading summary

### Caching
- Search: 30-minute TTL
- Fetch: 1-hour TTL
- `--no-cache` to bypass

## Debug flags

| Flag | Search | Fetch |
|------|--------|-------|
| Bypass cache | `--no-cache` | `--no-cache` |
| Raw output | `--text` | `--raw` |
| Force context | `--context coding` | — |
| Limit results | `--max N` | `--short` (4000 chars) |
| Increase timeout | — | `--timeout 30000` |
| Quiet output | — | `--quiet` |

## Error handling
- Search returns `[]` (empty array) on failure, never null
- Fetch returns raw HTML as fallback when all extraction fails