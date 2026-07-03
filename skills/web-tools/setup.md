# Setup Instructions

Create symlinks so `web_search` and `web_fetch` are on PATH. Adapt the path to match the install source.

## npm install

```bash
[ -L ~/.pi/agent/bin/web_search ] || ln -sf ~/.pi/agent/npm/node_modules/henyo-pi-web/skills/web-tools/web_search.js ~/.pi/agent/bin/web_search
[ -L ~/.pi/agent/bin/web_fetch ] || ln -sf ~/.pi/agent/npm/node_modules/henyo-pi-web/skills/web-tools/web_fetch.js ~/.pi/agent/bin/web_fetch
```

## git install

```bash
[ -L ~/.pi/agent/bin/web_search ] || ln -sf ~/.pi/agent/git/github.com/user/henyo-pi-web/skills/web-tools/web_search.js ~/.pi/agent/bin/web_search
[ -L ~/.pi/agent/bin/web_fetch ] || ln -sf ~/.pi/agent/git/github.com/user/henyo-pi-web/skills/web-tools/web_fetch.js ~/.pi/agent/bin/web_fetch
```

## local install

```bash
SEARCH_FILE=$(find /path/to/henyo-pi-web -name web_search.js -type f 2>/dev/null | head -1)
FETCH_FILE=$(find /path/to/henyo-pi-web -name web_fetch.js -type f 2>/dev/null | head -1)
[ -L ~/.pi/agent/bin/web_search ] || ln -sf "$SEARCH_FILE" ~/.pi/agent/bin/web_search
[ -L ~/.pi/agent/bin/web_fetch ] || ln -sf "$FETCH_FILE" ~/.pi/agent/bin/web_fetch
```

## Verify

```bash
web_search --help 2>&1 | head -2
```