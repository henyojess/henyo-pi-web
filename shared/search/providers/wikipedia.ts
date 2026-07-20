import { pickRandom, delay, USER_AGENTS } from '../../user-agents';
import { enqueue } from '../queue';
import { SearchResult, ProviderConfig } from './base';

// ─── Wikipedia Provider ──────────────────────────────────────────────────────

export async function searchWikipedia(query: string, _config?: ProviderConfig, signal?: AbortSignal): Promise<SearchResult[]> {
  return enqueue('wikipedia', async () => {
    await delay(1000 + Math.random() * 1500);

    try {
      const searchRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=10&format=json`,
        { signal, headers: { 'User-Agent': pickRandom(USER_AGENTS) } }
      );
      if (!searchRes.ok) return [];
      const searchData = await searchRes.json();
      const [titles, descriptions, urls] = searchData.slice(1);

      if (!titles || titles.length === 0) return [];

      // Use batch API to fetch all extracts in one request
      const batchRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles.join('|'))}&prop=extracts&exintro=true&exsentences=0&explaintext=true&format=json`,
        { signal, headers: { 'User-Agent': pickRandom(USER_AGENTS) } }
      );
      if (!batchRes.ok) {
        return titles.map((title: string, i: number) => ({
          title: title.substring(0, 200),
          url: urls[i] || '',
          snippet: descriptions[i] || '',
          source: 'wikipedia',
        }));
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
            source: 'wikipedia',
          });
          continue;
        }

        const extract = pages[pageId].extract || '';
        results.push({
          title: titles[i].substring(0, 200),
          url: urls[i] || '',
          snippet: extract ? extract.substring(0, 300) + (extract.length > 300 ? '...' : '') : descriptions[i] || '',
          source: 'wikipedia',
        });
      }

      return results;
    } catch {
      return [];
    }
  });
}