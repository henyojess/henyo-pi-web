import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { loadConfig } from "./shared/config";
import { createCache } from "./shared/cache";
import { detectContext, buildProviderChain } from "./shared/search/context";
import { PROVIDER_MAP } from "./shared/search/providers";
import type { SearchResult } from "./shared/search/providers";
import { fetchPage } from "./shared/fetch/pipeline";
import { formatResults, normalizeUrl } from "./shared/format";

export default function (pi: ExtensionAPI) {
  const config = loadConfig();

  // --- web_search tool ---
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web using DuckDuckGo, Stack Overflow, npm, GitHub, Wikipedia, " +
      "or Jina. Context-aware routing (coding vs general). Results cached 30 min.",
    promptSnippet:
      "Search the web. Supports DuckDuckGo, Stack Overflow, npm, GitHub, Wikipedia, Jina. Caching enabled.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      max: Type.Optional(Type.Integer({
        default: 10, minimum: 1, maximum: 50,
        description: "Max results to return",
      })),
      context: Type.Optional(Type.Union([
        Type.Literal("coding"),
        Type.Literal("general"),
        Type.Literal("auto"),
      ], {
        default: "auto",
        description: "Context: coding (SO, npm, GitHub), general (Wikipedia, Jina), or auto-detect",
      })),
      noCache: Type.Optional(Type.Boolean({
        default: false,
        description: "Skip cache",
      })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const { query, max = 10, context = "auto", noCache = false } = params;
      const searchConfig = config["web-search"];
      const contextName = context === "auto" ? detectContext(query) : context;
      const providers = buildProviderChain(contextName, searchConfig.contexts || {});

      if (providers.length === 0) {
        throw new Error(`No providers configured for context: ${contextName}`);
      }

      const cache = createCache<SearchResult[]>(
        `${process.env.HOME}/.pi/tools-cache/web_search`,
        1800,
      );

      const cacheKey = `search:${contextName}:${query}`;
      if (!noCache) {
        const cached = cache.get(cacheKey);
        if (cached) {
          return {
            content: [{ type: "text", text: `[cache hit — ${cached.length} results]\n\n${formatResults(cached)}` }],
            details: { cached: true, count: cached.length },
          };
        }
      }

      // Run providers sequentially by priority group
      const priorities = [...new Set(providers.map(p => p.priority))].sort((a, b) => a - b);
      const allResults: SearchResult[] = [];

      for (const priority of priorities) {
        if (signal?.aborted) {
          return { content: [{ type: "text", text: "Search cancelled" }] };
        }

        const group = providers.filter(p => p.priority === priority);
        for (const provider of group) {
          if (signal?.aborted) {
            return { content: [{ type: "text", text: "Search cancelled" }] };
          }

          onUpdate?.({ content: [{ type: "text", text: `  [${provider.name}] Searching...` }] });

          try {
            // SearXNG needs the URL from config
            let results: SearchResult[];
            if (provider.name === 'searxng') {
              const searxngConfig = (searchConfig.contexts || {})[contextName]?.searxng || {};
              results = await provider.fn(searxngConfig.url || '', query);
            } else {
              results = await provider.fn(query);
            }
            onUpdate?.({ content: [{ type: "text", text: `  [${provider.name}] Found ${results.length} results` }] });
            allResults.push(...results);
          } catch (err: any) {
            onUpdate?.({ content: [{ type: "text", text: `  [${provider.name}] Error: ${err.message || err}` }] });
          }
        }

        // Deduplicate
        const seen = new Set<string>();
        const deduped: SearchResult[] = [];
        for (const r of allResults) {
          const key = normalizeUrl(r.url);
          if (!seen.has(key)) { seen.add(key); deduped.push(r); }
        }
        allResults.length = 0;
        allResults.push(...deduped);

        if (allResults.length >= max) break;
      }

      const results = allResults.slice(0, max);

      if (!noCache) {
        cache.put(cacheKey, results);
      }

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "No results found." }],
          details: { count: 0 },
        };
      }

      return {
        content: [{ type: "text", text: formatResults(results) }],
        details: { count: results.length, context: contextName },
      };
    },
  });

  // --- web_fetch tool ---
  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Extract clean readable content from any URL. Uses Defuddle locally with Jina Reader fallback. " +
      "Handles Cloudflare protection, SPAs, GitHub raw files. Cached 1 hour.",
    promptSnippet:
      "Extract clean content from a URL. Defuddle + Jina fallback. Handles protected/JS-heavy pages. Caching enabled.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch" }),
      timeout: Type.Optional(Type.Integer({
        default: 15000, minimum: 1000, maximum: 60000,
        description: "Request timeout in milliseconds",
      })),
      noCache: Type.Optional(Type.Boolean({
        default: false,
        description: "Skip cache",
      })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const { url, timeout = 15000, noCache = false } = params;

      onUpdate?.({ content: [{ type: "text", text: `Fetching ${url}...` }] });

      try {
        const result = await fetchPage({
          url,
          timeout,
          noCache,
          config: config["web-fetch"],
          signal,
          onUpdate,
        });

        return {
          content: [{ type: "text", text: result.text }],
          details: {
            url: result.resolvedUrl,
            title: result.title,
            source: result.source,
            truncated: result.truncated,
          },
        };
      } catch (err: any) {
        throw new Error(`Failed to fetch ${url}: ${err.message || err}`);
      }
    },
  });
}