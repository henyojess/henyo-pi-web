---
name: web-tools
description: Use when routing web searches to the right tool, shaping queries, or recovering from empty results — teaches routing, query shaping, zero-results recovery, fallback chains, and cache/rate-limit behavior of the six web research tools. Load before a multi-query research pass or when a web search returns zero or weak results.
---

# Web Tools

Routing and usage guide for the six web research tools: `search_ddg`,
`search_wikipedia`, `search_stackoverflow`, `search_npm`, `search_github`,
`henyo_fetch`.

## Activation

The six tools are lazy — registered but **inactive** until enabled for the
session. If the web search/fetch tools are not in your active tool list, call
`web_tools` first (or ask the user to run `/web-tools`). Activation is
all-or-nothing and additive; once enabled, all six stay enabled for the
session.

## Routing

| Tool | Use for | Query shaping | Don't use for (→ tool) |
|------|---------|---------------|------------------------|
| `search_ddg` | General web: news, articles, broad topics; fallback when no specialized tool fits | Focused topic, question, or phrase — keep it short | Encyclopedia definitions (→ `search_wikipedia`); programming errors (→ `search_stackoverflow`); package lookups (→ `search_npm`); repo/source searches (→ `search_github`) |
| `search_wikipedia` | Encyclopedia: definitions, concepts, history, factual background | Short topic names, not full questions | Code errors (→ `search_stackoverflow`); recent news (→ `search_ddg`); package docs (→ `search_npm`); Q&A (→ `search_stackoverflow`) |
| `search_stackoverflow` | Programming Q&A: error messages, debugging, syntax, API usage | Title keywords only — AND semantics, every word must appear in the question title; error text only when copied verbatim into the title (common runtime errors). Vote ranking/answer bodies → `henyo_fetch` SE API (see fallback chains) | General CS concepts (→ `search_wikipedia`); package docs (→ `search_npm`); repo searches (→ `search_github`); non-programming topics (→ `search_ddg`) |
| `search_npm` | npm registry: package names, JS library lookups, dependency discovery | Package name or functionality — short and specific | General JS questions (→ `search_stackoverflow`); GitHub repos (→ `search_github`); non-JS packages (pip, crates) (→ `search_ddg`) |
| `search_github` | GitHub: repositories and issues (not source code) | Repo/library names and issue keywords — short names, not sentences | Package docs (→ `search_npm`); Q&A (→ `search_stackoverflow`); general web search (→ `search_ddg`) |
| `henyo_fetch` | Fetch and extract one known URL into clean readable text | Exact URL; `timeout` for slow pages; `headers` for auth | Discovering URLs (search first) |

## Query shaping: good vs. bad

| Tool | Good | Bad | Why |
|------|------|-----|-----|
| `search_ddg` | `Rust async runtime comparison` | `Tell me everything about how async runtimes work in Rust and which one is best and why` | Long multi-clause queries return weaker results |
| `search_wikipedia` | `Kubernetes` | `how does k8s scheduling work in general?` | Full questions → 0 hits; use the short topic name |
| `search_stackoverflow` | `debounce function`, `javascript closure`, `Uncaught TypeError: Cannot read properties of undefined (reading 'map')` (verbatim title text) | `how to debounce a function in JavaScript` (full sentence → 0 hits), `memoize javascript` (added word kills all matches → 0 hits) | Every word must appear in the question title (AND semantics) — drop words to retry, don't add them |
| `search_npm` | `state machine` | `a package that does everything I need` | Functionality must be a concrete capability keyword |
| `search_github` | `opencode` | `sst/opencode websearch web fetch tool` | Multi-word repo-shaped string → genuine 0 hits; search by the name |

## Zero-results protocol

| Message | Meaning | Required response |
|---------|---------|-------------------|
| `No results found.` | Genuine zero results | Rephrase **shorter** (topic/repo name, drop modifiers) and retry once. Still zero → next appropriate tool per the routing table. Still nothing → report to the user. |
| `Search cooling down for Ns — try again shortly or use a different search tool.` | Provider rate limit active | Use a different tool now; retry this provider after N seconds. Do not hammer it. |
| `Provider error (tool): … — no results returned. Try again later or use a different search tool.` | Provider failure | Retry once. If it persists, use a different tool and note the failure. |

**Never silently fall back to `curl`/raw fetch in bash for web search or page
fetch** — it bypasses caching, rate limits, SSRF protection, and extraction.
A bash fallback is only legitimate after telling the user why the tools are
unavailable.

**`search_stackoverflow` note:** zero hits here mean no question title contains
**all** the query words — so retrying means **dropping words** (each word is a
title constraint), not just shortening or rephrasing. After 2 failed retries
→ `search_ddg` with `site:stackoverflow.com <query>`.

## Fallback chains

- Weak `search_ddg` results → `henyo_fetch` a promising URL from them
- `search_wikipedia` 0 hits on a question → rephrase as a short topic name, or use `search_ddg`
- `search_npm` 0 hits → `search_github` (repo names, issue keywords), then `search_ddg`
- Rate-limited provider (cooling down) → switch to another search tool, as the message advises
- `search_stackoverflow` 0 hits (no title match) → `search_ddg` with `site:stackoverflow.com <query>` (model-driven — the SE API only AND-matches question titles)
- `henyo_fetch` 401/403/503 (e.g. Cloudflare blocks) → now auto-recovers via the Wayback Machine when eligible (result tagged `source: 'wayback'` + `snapshotDate` + `originalUrl`); disable with `waybackEnabled: false`
- Fresh SO content (latest answers/scores) → `henyo_fetch` on `api.stackexchange.com/2.3/questions/{id}?site=stackoverflow` and `.../questions/{id}/answers?site=stackoverflow&order=desc&sort=votes&filter=withbody` (the `site` param is required for by-ID queries — without it the API 400s with `site is required`); never `henyo_fetch` a `stackoverflow.com` page expecting fresh content
- `henyo_fetch` 404/forbidden on a search result URL → fetch the next result URL instead (403 now auto-recovers via Wayback first — the tagged archived snapshot may be enough)

## Runtime behavior

- Search results are cached 30 min (`shared/search/execute.ts:34`)
- Fetches are cached 1 h (`shared/fetch/pipeline.ts:110`)
- Fetch auto-fallback: 401/403/503 on the direct fetch → Wayback snapshot, tagged `source: 'wayback'` with `snapshotDate`; no freshness cutoff — staleness is the tag's job
- All six tools accept `noCache` to skip the respective cache
- "Search cooling down for Ns" is a provider-side cooldown — do not retry that
  provider before N seconds have passed
- Oversized fetches return a JSON envelope with `cacheFilePath` and a read
  strategy: prefer grep or read with offset/limit to extract specific sections;
  don't read the whole file
- When `henyo-search.trace` is set in settings, **every** search/fetch outcome is
  logged to `/tmp/henyo-trace.log` (tool + provider layers: cache hits,
  cooldown blocks with `error="http-429"`/`error="captcha"` etc., no-results,
  errors, successes; fetch: ok/cache/oversized/size-exceeded/error) — check it
  first when a search or fetch behaves unexpectedly

Multi-step deep research (planning, cross-validation, reporting) →
`/skill:deep-research`.
