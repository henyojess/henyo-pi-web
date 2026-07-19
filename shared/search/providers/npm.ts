import { pickRandom, delay, USER_AGENTS } from '../../user-agents';
import { enqueue } from '../queue';
import { SearchResult } from './base';

// ─── npm Provider ────────────────────────────────────────────────────────────

export async function searchNpm(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  return enqueue('npm', async () => {
    await delay(1000 + Math.random() * 1500);

    try {
      const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=10`, {
        signal,
        headers: { 'User-Agent': pickRandom(USER_AGENTS) },
      });

      if (!res.ok) return [];
      const data = await res.json();

      return (data.objects || []).map((obj: any) => {
        const pkg = obj.package;
        return {
          title: `${pkg.name}@${pkg.version}`,
          url: `https://www.npmjs.com/package/${pkg.name}`,
          snippet: pkg.description || '',
          source: 'npm',
        };
      });
    } catch {
      return [];
    }
  });
}