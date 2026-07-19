import { pickRandom, delay, USER_AGENTS } from '../../user-agents';
import { enqueue } from '../queue';
import { SearchResult } from './base';

// ─── SearXNG Provider ────────────────────────────────────────────────────────

export async function searchSearXNG(url: string, query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  if (!url) return [];

  return enqueue('searxng', async () => {
    await delay(1000 + Math.random() * 1500);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      signal?.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        controller.abort();
      }, { once: true });

      const res = await fetch(`${url}/search?q=${encodeURIComponent(query)}&format=json`, {
        signal: controller.signal,
        headers: { 'User-Agent': pickRandom(USER_AGENTS) },
      });

      if (!res.ok) return [];
      const data = await res.json();

      return (data.results || []).slice(0, 10).map((r: any) => ({
        title: r.title || 'Untitled',
        url: r.url || '',
        snippet: (r.content || '').substring(0, 300),
        source: 'searxng',
      }));
    } catch {
      return [];
    }
  });
}