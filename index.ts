import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";

import { loadConfig, validateConfig } from "./shared/config";
import { createCache } from "./shared/cache";
import { detectContext, buildProviderChain } from "./shared/search/context";
import { PROVIDER_MAP } from "./shared/search/providers";
import type { SearchResult } from "./shared/search/providers";
import { fetchPage } from "./shared/fetch/pipeline";
import { formatResults, normalizeUrl, diversifyByDomain, rankResults } from "./shared/format";

function getCacheDir(subdir: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!process.env.HOME && process.env.USERPROFILE) {
    console.warn('[henyo-search] HOME is undefined, using USERPROFILE for cache path');
  }
  return `${home}/.pi/tools-cache/${subdir}`;
}

// ─── TUI rendering helpers ───────────────────────────────────────────────────

function buildCollapsedHeader(details: { query?: string; context?: string; count?: number; providers?: Array<{ name: string; status: string; error?: string; count?: number }> }, theme: Theme): string {
  const context = details.context ?? 'general';
  const count = details.count ?? 0;

  if (details.providers && details.providers.length > 0) {
    const sorted = [...details.providers].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    const providerParts = sorted.map(p => {
      if (p.status === 'error') {
        return `${theme.fg('error', `${p.name}(error)`)}`;
      }
      return `${theme.fg('muted', `${p.name}:${p.count ?? 0}`)}`;
    });
    return `${theme.fg('muted', `${context}(${count}) · ${providerParts.join(' ')}`)}`;
  }

  return theme.fg('muted', `${context}(${count})`);
}

function buildExpandedContent(result: { content: Array<{ type: string; text: string }> }): string {
  const textContent = result.content.find(c => c.type === 'text');
  return textContent?.text ?? '';
}

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  validateConfig(config);

  // --- henyo_search tool ---
  pi.registerTool({
    name: "henyo_search",
    label: "Henyo Search",
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
        description: "Context: coding (SO, npm, GitHub), general (DDG, Wikipedia), or auto-detect"
      })),
      noCache: Type.Optional(Type.Boolean({
        default: false,
        description: "Skip cache",
      })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const { query, max = 10, context = "auto", noCache = false } = params;
      const searchConfig = config["henyo-search"];
      const contextName = context === "auto" ? detectContext(query) : context;
      const providers = buildProviderChain(contextName, searchConfig.contexts || {});

      if (providers.length === 0) {
        throw new Error(`No providers configured for context: ${contextName}`);
      }

      // Single progress update at start
      onUpdate?.({ content: [{ type: "text", text: `Searching ${contextName} context (${providers.length} providers)...` }] });

      const cache = createCache<SearchResult[]>(
        getCacheDir('henyo_search'),
        1800,
      );

      // Per-context ranking config (default true)
      const contextConfig = searchConfig.contexts?.[contextName] || {};
      const rankingEnabled = contextConfig.ranking ?? true;

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
              details: { count: diversified.length, context: contextName, providers: providerResults.map(p => ({ name: p.name, status: p.status, error: p.error, count: (p as any).count })), aborted: true },
            };
          }
          return { content: [{ type: "text", text: "Search cancelled" }], details: { count: 0, context: contextName, providers: providerResults.map(p => ({ name: p.name, status: p.status, error: p.error, count: (p as any).count })), aborted: true } };
        }

        const group = providers.filter(p => p.priority === priority);
        for (const provider of group) {
          if (signal?.aborted) {
            providerResults.push({ name: provider.name, status: 'timeout' });
            continue;
          }

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
            allResults.push(...results);
            providerResults.push({ name: provider.name, status: 'ok', count: results.length });
          } catch (err: any) {
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

        // Rank results within this priority group (corpus-level BM25)
        if (rankingEnabled) {
          const ranked = rankResults(query, allResults);
          allResults.length = 0;
          allResults.push(...ranked);
        }
      }

      const diversified = diversifyByDomain(allResults, 2);
      const results = diversified.slice(0, max);

      if (!noCache) {
        cache.put(cacheKey, results);
      }

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "No results found." }],
          details: { count: 0, context: contextName, providers: providerResults.map(p => ({ name: p.name, status: p.status, error: p.error, count: (p as any).count })) },
        };
      }

      return {
        content: [{ type: "text", text: formatResults(results) }],
        details: { count: results.length, context: contextName, providers: providerResults.map(p => ({ name: p.name, status: p.status, error: p.error, count: (p as any).count })) },
      };
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", "henyo_search ") + theme.fg("muted", `"${args.query}"`), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      // Show processing state for partial results
      if (isPartial) {
        return new Text(theme.fg("muted", "Processing..."), 0, 0);
      }

      // Build header with query, context, count, and provider breakdown
      const details = (result.details as any) || {};
      const providers = details.providers || [];
      // Use the post-slice count from execute() — accurate after dedup/rank/diversify/max
      const count = details.count ?? providers.reduce((sum: number, p: any) => sum + (p.count ?? 0), 0);
      let header = buildCollapsedHeader({
        query: context?.args?.query ?? details.query ?? '',
        context: details.context,
        count: count,
        providers: providers,
      }, theme);

      if (expanded) {
        // Append full content text
        const expandedText = buildExpandedContent(result);
        if (expandedText) {
          header = `${header}\n\n${expandedText}`;
        }
      } else {
        // Show key hint so users know how to expand
        header = `${header} (${theme.fg("muted", "press " + keyHint("app.tools.expand", "to expand"))})`;
      }

      return new Text(header, 0, 0);
    },
  });

  // --- henyo_fetch tool ---
  pi.registerTool({
    name: "henyo_fetch",
    label: "Henyo Fetch",
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
      headers: Type.Optional(Type.Record(Type.String(), Type.String(), {
        description: "Custom HTTP headers (e.g., { 'Authorization': 'Bearer token' })",
      })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const { url, timeout = 15000, noCache = false, headers } = params;

      onUpdate?.({ content: [{ type: "text", text: `Fetching ${url}...` }] });

      try {
        const result = await fetchPage({
          url,
          timeout,
          noCache,
          config: config["henyo-fetch"],
          signal,
          onUpdate,
          headers,
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