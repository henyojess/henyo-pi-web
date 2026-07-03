---
name: web-tools
description: Web search and content extraction. These CLI tools are also registered as native Pi tools via the extension. For manual use only.
license: MIT
compatibility: Requires Node.js (ESM) and internet access.
---

# Web Tools (Manual Use)

These CLI tools are also registered as native Pi tools via the extension.
For manual use:

    web_search <query> [--max N] [--text] [--no-cache] [--context coding|general]
    web_fetch <url> [--raw] [--quiet] [--short] [--no-cache] [--timeout <ms>]

Setup: see setup.md if tools are not on PATH.