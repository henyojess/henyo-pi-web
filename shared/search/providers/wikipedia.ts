import { pickRandom, USER_AGENTS } from '../../user-agents';
import { enqueue } from '../queue';
import { SearchResult, sanitizeQuery } from './base';
import { traceEnd } from '../trace';

// ─── Wikipedia Provider ──────────────────────────────────────────────────────

export async function searchWikipedia(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const startTime = Date.now();
  return enqueue('wikipedia', async () => {
    try {
      // Wikipedia's OpenSearch API is a prefix/title search — sanitize to
      // avoid quote/special-char breakage. Raw query is preserved for BM25.
      const wikiQuery = sanitizeQuery(query);

      const searchRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(wikiQuery)}&limit=10&format=json`,
        { signal, headers: { 'User-Agent': pickRandom(USER_AGENTS) } }
      );
      if (!searchRes.ok) throw new Error(`Wikipedia API HTTP ${searchRes.status}`);
      const searchData = await searchRes.json();
      const [titles, descriptions, urls] = searchData.slice(1);

      if (!titles || titles.length === 0) {
        traceEnd('wikipedia', query, startTime, { status: 'no-results', resultCount: 0 });
        return [];
      }

      // Use batch API to fetch all extracts in one request
      const batchRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles.join('|'))}&prop=extracts&exintro=true&exsentences=0&explaintext=true&format=json`,
        { signal, headers: { 'User-Agent': pickRandom(USER_AGENTS) } }
      );
      if (!batchRes.ok) {
        const fallback = titles.map((title: string, i: number) => ({
          title: title.substring(0, 200),
          url: urls[i] || '',
          snippet: descriptions[i] || '',
          domain: 'wikipedia.org',
          source: 'wikipedia',
        }));
        traceEnd('wikipedia', query, startTime, { status: 'ok', resultCount: fallback.length });
        return fallback;
      }

      const batchData = await batchRes.json();
      const pages = batchData.query.pages;
      const results: SearchResult[] = [];

      for (let i = 0; i < titles.length; i++) {
        const pageId = Object.keys(pages).find(k => pages[k].title === titles[i]);
        if (!pageId) {
          results.push({
            title: titles[i].substring(0, 200),
            url: urls[i] || '',
            snippet: descriptions[i] || '',
            domain: 'wikipedia.org',
            source: 'wikipedia',
          });
          continue;
        }

        const extract = pages[pageId].extract || '';
        results.push({
          title: titles[i].substring(0, 200),
          url: urls[i] || '',
          snippet: extract ? extract.substring(0, 300) + (extract.length > 300 ? '...' : '') : descriptions[i] || '',
          domain: 'wikipedia.org',
          source: 'wikipedia',
        });
      }

      traceEnd('wikipedia', query, startTime, { status: 'ok', resultCount: results.length });
      return results;
    } catch (err) {
      if (signal?.aborted) {
        traceEnd('wikipedia', query, startTime, { status: 'aborted', resultCount: 0 });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        traceEnd('wikipedia', query, startTime, { status: 'error', resultCount: 0, error: message });
      }
      // Re-throw: surface search-call failures, network errors, and aborts.
      // (Batch extract failures already fall back gracefully above.)
      throw err;
    }
  });
}