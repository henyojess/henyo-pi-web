import { pickRandom, delay, USER_AGENTS } from '../../user-agents';
import { enqueue } from '../queue';
import { SearchResult } from './base';

// ─── Jina Search Provider ────────────────────────────────────────────────────

export async function searchJina(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  return enqueue('jina', async () => {
    await delay(1000 + Math.random() * 1500);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      signal?.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        controller.abort();
      }, { once: true });

      const res = await fetch('https://s.jina.ai/', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'User-Agent': pickRandom(USER_AGENTS),
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ search: query }),
      });

      if (!res.ok) return [];
      const data = await res.json();

      return (data.results || []).map((r: any) => ({
        title: r.title || 'Untitled',
        url: r.url || '',
        snippet: (r.content || '').replace(/<[^>]+>/g, ' ').trim().substring(0, 300),
        source: 'jina-search',
      }));
    } catch {
      return [];
    }
  });
}