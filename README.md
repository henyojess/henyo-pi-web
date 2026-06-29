# henyo-pi-web

Web search and content extraction tools for [Pi](https://github.com/earendil-works/pi).

**Henyo** means "genius" in Filipino — because Pi is sharp, and so are you.

## Install

**Ask your Pi agent:**

```
Install the henyo-pi-web npm package and the web-tools skill
```

Or run directly in your terminal:

```bash
pi install npm:henyo-pi-web
ln -sf ~/.pi/agent/npm/henyo-pi-web/skills/web-tools/web_search.js ~/.pi/agent/bin/web_search
ln -sf ~/.pi/agent/npm/henyo-pi-web/skills/web-tools/web_fetch.js ~/.pi/agent/bin/web_fetch
```

> `pi install` automatically resolves npm dependencies (`defuddle`, `jsdom`). The two `ln -sf` commands make the scripts available on PATH so the agent can invoke them.

## Usage

```bash
/skill:web-tools
```

The skill provides two CLI scripts:

- **`web_search`** — Search the web via multiple providers (DuckDuckGo, Stack Overflow, npm, GitHub, Wikipedia, Jina)
- **`web_fetch`** — Fetch and extract readable content from any URL (with Defuddle + Jina fallback)

### web_search

```bash
web_search query "how to handle errors in React" --max 5
web_search query "latest weather today" --max 3 --context general
web_search query "TypeError: cannot read" --max 3 --context coding
```

### web_fetch

```bash
web_fetch url "https://example.com/article" --format json
web_fetch url "https://github.com/user/repo/blob/main/README.md" --short
```

## Configuration

Optional settings go in `~/.pi/settings.json`:

```json
{
  "web-fetch": {
    "jinaEnabled": true,
    "min-delay": 1000,
    "max-delay": 3000,
    "cache-max-files": 100,
    "heading-threshold": 40000
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