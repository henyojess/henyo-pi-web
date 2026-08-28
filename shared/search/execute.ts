import { createCache } from '../cache';
import { rateLimitStore } from '../rate-limit';
import { SearchResult, sanitizeQuery, ProviderConfig } from './providers/base';
import { formatResults, rankResults, diversifyByDomain } from '../format';
import { traceEnd } from './trace';

// toolName → rate-limit provider key (maps to DEFAULT_RATE_LIMIT_COOLDOWNS keys)
const TOOL_PROVIDER_KEYS: Record<string, string> = {
  search_ddg: 'duckduckgo',
  search_wikipedia: 'wikipedia',
  search_stackoverflow: 'stackoverflow',
  search_npm: 'npm',
  search_github: 'github',
};

/** Get cache directory for a search tool */
function getSearchCacheDir(toolName: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return `${home}/.pi/tools-cache/${toolName}`;
}

export function createSearchExecute(
  providerFn: (query: string, signal?: AbortSignal, config?: ProviderConfig) => Promise<SearchResult[]>,
  toolName: string,
  needsSanitization: boolean,
  providerConfig?: ProviderConfig,
) {
  return async (_toolCallId: string, params: { query: string; max?: number; noCache?: boolean }, signal: AbortSignal | undefined, _onUpdate: any, _ctx: any) => {
    // Wire trace config for providers that check globalThis.__henyoTraceConfig
    (globalThis as any).__henyoTraceConfig = providerConfig?.trace ?? false;
    const startTime = Date.now();
    const { query, max = 10, noCache = false } = params;

    const cache = createCache<SearchResult[]>(
      getSearchCacheDir(toolName),
      1800,
    );

    const cacheKey = `search:${toolName}:${query}`;
    if (!noCache) {
      const cached = cache.get(cacheKey);
      if (cached && cached.length > 0) {
        traceEnd(toolName, query, startTime, { status: 'cache-hit', resultCount: cached.length });
        return {
          content: [{ type: "text", text: `[cache hit — ${cached.length} results]\n\n${formatResults(cached)}` }],
          details: { cached: true, count: cached.length, providers: [{ name: toolName, status: 'ok' as const }] },
        };
      }
    }

    // Sanitize or pass raw query depending on provider
    const searchQuery = needsSanitization ? sanitizeQuery(query) : query;

    // Enforce rate-limit cooldown before firing (built-in durations only)
    const providerKey = TOOL_PROVIDER_KEYS[toolName];
    if (providerKey) {
      const remaining = rateLimitStore.remainingMs(providerKey);
      if (remaining > 0) {
        traceEnd(toolName, query, startTime, { status: 'cooling-down', resultCount: 0, error: providerKey });
        return {
          content: [{ type: "text", text: `Search cooling down for ${Math.ceil(remaining / 1000)}s — try again shortly or use a different search tool.` }],
          details: { count: 0, coolingDown: true, remainingMs: remaining },
        };
      }
    }

    const providerResults: Array<{ name: string; status: 'ok' | 'error' }> = [];
    let results: SearchResult[];
    try {
      results = await providerFn(searchQuery, signal, providerConfig);
      providerResults.push({ name: toolName, status: 'ok' });
    } catch (err: any) {
      providerResults.push({ name: toolName, status: 'error' });
      if (signal?.aborted) {
        // Abort fired mid-flight (fetch rejects with AbortError) — not a provider failure
        traceEnd(toolName, query, startTime, { status: 'aborted', resultCount: 0 });
        return {
          content: [{ type: "text", text: "Search cancelled" }],
          details: { count: 0, aborted: true, providers: providerResults },
        };
      }
      // Surface the provider failure visibly — never a silent "No results found."
      traceEnd(toolName, query, startTime, { status: 'error', resultCount: 0, error: err?.message ?? String(err) });
      return {
        content: [{ type: "text", text: `Provider error (${toolName}): ${err?.message ?? err} — no results returned. Try again later or use a different search tool.` }],
        details: { count: 0, providers: providerResults },
      };
    }

    // Apply BM25 ranking and domain diversification before slicing
    const ranked = rankResults(query, results);
    const diversified = diversifyByDomain(ranked, 2);

    // Check for abort — return partial results if signal was triggered
    if (signal?.aborted) {
      traceEnd(toolName, query, startTime, { status: 'aborted', resultCount: Math.min(diversified.length, max) });
      return {
        content: [{ type: "text", text: diversified.length > 0 ? formatResults(diversified.slice(0, max)) : "Search cancelled" }],
        details: { count: diversified.length, aborted: true, providers: providerResults },
      };
    }

    if (!noCache && results.length > 0) {
      cache.put(cacheKey, results);
    }

    if (diversified.length === 0) {
      traceEnd(toolName, query, startTime, { status: 'no-results', resultCount: 0 });
      return {
        content: [{ type: "text", text: "No results found." }],
        details: { count: 0, providers: providerResults },
      };
    }

    const sliced = diversified.slice(0, max);
    traceEnd(toolName, query, startTime, { status: 'ok', resultCount: sliced.length });
    return {
      content: [{ type: "text", text: formatResults(sliced) }],
      details: { count: sliced.length, providers: providerResults },
    };
  };
}
