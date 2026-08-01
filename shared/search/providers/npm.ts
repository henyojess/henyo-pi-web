import { pickRandom, USER_AGENTS } from '../../user-agents';
import { enqueue } from '../queue';
import { SearchResult, sanitizeQuery } from './base';

// ─── npm Provider ────────────────────────────────────────────────────────────

export async function searchNpm(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  return enqueue('npm', async () => {
    try {
      // npm registry search expects package-name-like input; sanitize to
      // strip quotes/special chars that break registry queries.
      const sanitizedQuery = sanitizeQuery(query);
      const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(sanitizedQuery)}&size=10`, {
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
          domain: 'npmjs.com',
          source: 'npm',
        };
      });
    } catch {
      return [];
    }
  });
}