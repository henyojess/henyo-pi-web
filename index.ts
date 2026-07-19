import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { loadConfig, validateConfig } from "./shared/config";
import { createCache } from "./shared/cache";
import { detectContext, buildProviderChain } from "./shared/search/context";
import { PROVIDER_MAP } from "./shared/search/providers";
import type { SearchResult } from "./shared/search/providers";
import { fetchPage } from "./shared/fetch/pipeline";
import { formatResults, normalizeUrl, diversifyByDomain } from "./shared/format";

function getCacheDir(subdir: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!process.env.HOME && process.env.USERPROFILE) {
    console.warn('[web-search] HOME is undefined, using USERPROFILE for cache path');
  }
  return `${home}/.pi/tools-cache/${subdir}`;
}

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  validateConfig(config);

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
        getCacheDir('web_search'),
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
      const providerResults: Array<{ name: string; status: 'ok' | 'error' | 'timeout' | 'cooldown'; error?: string }> = [];

      for (const priority of priorities) {
        if (signal?.aborted) {
          // Return partial results on abort
          const partial = allResults.slice(0, max);
          if (partial.length > 0) {
            const diversified = diversifyByDomain(partial, 2);
            return {
              content: [{ type: "text", text: formatResults(diversified) }],
              details: { count: diversified.length, context: contextName, providers: providerResults.map(p => ({ name: p.name, status: p.status, error: p.error })), aborted: true },
            };
          }
          return { content: [{ type: "text", text: "Search cancelled" }], details: { count: 0, context: contextName, providers: providerResults.map(p => ({ name: p.name, status: p.status, error: p.error })), aborted: true } };
        }

        const group = providers.filter(p => p.priority === priority);
        for (const provider of group) {
          if (signal?.aborted) {
            providerResults.push({ name: provider.name, status: 'timeout' });
            continue;
          }

          onUpdate?.({ content: [{ type: "text", text: `  [${provider.name}] Searching...` }] });

          try {
            // Provider-specific config
            let results: SearchResult[];
            if (provider.name === 'searxng') {
              const searxngConfig = searchConfig.contexts?.[contextName]?.searxng;
              results = await provider.fn(query, { url: searxngConfig?.url }, signal);
            } else if (provider.name === 'stackoverflow') {
              const apiKey = searchConfig['api-key'];
              results = await provider.fn(query, { apiKey }, signal);
            } else {
              results = await provider.fn(query, undefined, signal);
            }
            onUpdate?.({ content: [{ type: "text", text: `  [${provider.name}] Found ${results.length} results` }] });
            allResults.push(...results);
            providerResults.push({ name: provider.name, status: 'ok' });
          } catch (err: any) {
            onUpdate?.({ content: [{ type: "text", text: `  [${provider.name}] Error: ${err.message || err}` }] });
            providerResults.push({ name: provider.name, status: 'error', error: err.message || String(err) });
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

      const diversified = diversifyByDomain(allResults, 2);
      const results = diversified.slice(0, max);

      if (!noCache) {
        cache.put(cacheKey, results);
      }

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "No results found." }],
          details: { count: 0, context: contextName, providers: providerResults.map(p => ({ name: p.name, status: p.status, error: p.error })) },
        };
      }

      return {
        content: [{ type: "text", text: formatResults(results) }],
        details: { count: results.length, context: contextName, providers: providerResults.map(p => ({ name: p.name, status: p.status, error: p.error })) },
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

        // Handle oversized content — return metadata only, let agent decide
        if (result.oversized) {
          const sizeKB = (result.contentLength! / 1024).toFixed(1);
          return {
            content: [{
              type: "text",
              text: `[Cached — ${sizeKB} KB]\n\nURL: ${result.resolvedUrl}\nTitle: ${result.title}\nSource: ${result.source}\nCache: ${result.cacheFilePath}]`,
            }],
            details: {
              url: result.resolvedUrl,
              title: result.title,
              source: result.source,
              cached: true,
              cacheFilePath: result.cacheFilePath,
              contentLength: result.contentLength,
              contentLengthKB: Number(sizeKB),
            },
          };
        }

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