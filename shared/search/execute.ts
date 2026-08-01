import { createCache } from '../cache';
import { SearchResult, sanitizeQuery } from './providers/base';
import { formatResults, rankResults, diversifyByDomain } from '../format';

/** Get cache directory for a search tool */
function getSearchCacheDir(toolName: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return `${home}/.pi/tools-cache/${toolName}`;
}

export function createSearchExecute(
  providerFn: (query: string, signal?: AbortSignal) => Promise<SearchResult[]>,
  toolName: string,
  needsSanitization: boolean,
) {
  return async (_toolCallId: string, params: { query: string; max?: number; noCache?: boolean }, signal: AbortSignal | undefined, _onUpdate: any, _ctx: any) => {
    const { query, max = 10, noCache = false } = params;

    const cache = createCache<SearchResult[]>(
      getSearchCacheDir(toolName),
      1800,
    );

    const cacheKey = `search:${toolName}:${query}`;
    if (!noCache) {
      const cached = cache.get(cacheKey);
      if (cached) {
        return {
          content: [{ type: "text", text: `[cache hit — ${cached.length} results]\n\n${formatResults(cached)}` }],
          details: { cached: true, count: cached.length, providers: [{ name: toolName, status: 'ok' as const }] },
        };
      }
    }

    // Sanitize or pass raw query depending on provider
    const searchQuery = needsSanitization ? sanitizeQuery(query) : query;

    const providerResults: Array<{ name: string; status: 'ok' | 'error' }> = [];
    let results: SearchResult[];
    try {
      results = await providerFn(searchQuery, signal);
      providerResults.push({ name: toolName, status: 'ok' });
    } catch (err: any) {
      providerResults.push({ name: toolName, status: 'error' });
      return {
        content: [{ type: "text", text: "No results found." }],
        details: { count: 0, providers: providerResults },
      };
    }

    // Apply BM25 ranking and domain diversification before slicing
    const ranked = rankResults(query, results);
    const diversified = diversifyByDomain(ranked, 2);

    // Check for abort — return partial results if signal was triggered
    if (signal?.aborted) {
      return {
        content: [{ type: "text", text: diversified.length > 0 ? formatResults(diversified.slice(0, max)) : "Search cancelled" }],
        details: { count: diversified.length, aborted: true, providers: providerResults },
      };
    }

    if (!noCache) {
      cache.put(cacheKey, results);
    }

    if (diversified.length === 0) {
      return {
        content: [{ type: "text", text: "No results found." }],
        details: { count: 0, providers: providerResults },
      };
    }

    const sliced = diversified.slice(0, max);
    return {
      content: [{ type: "text", text: formatResults(sliced) }],
      details: { count: sliced.length, providers: providerResults },
    };
  };
}
