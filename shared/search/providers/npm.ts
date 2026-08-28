import { pickRandom, USER_AGENTS } from '../../user-agents';
import { enqueue } from '../queue';
import { SearchResult, sanitizeQuery } from './base';
import { traceEnd } from '../trace';

// ─── npm Provider ────────────────────────────────────────────────────────────

export async function searchNpm(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const startTime = Date.now();
  return enqueue('npm', async () => {
    try {
      // npm registry search expects package-name-like input; sanitize to
      // strip quotes/special chars that break registry queries.
      const sanitizedQuery = sanitizeQuery(query);
      const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(sanitizedQuery)}&size=10`, {
        signal,
        headers: { 'User-Agent': pickRandom(USER_AGENTS) },
      });

      if (!res.ok) throw new Error(`npm registry HTTP ${res.status}`);
      const data = await res.json();

      const results = (data.objects || []).map((obj: any) => {
        const pkg = obj.package;
        return {
          title: `${pkg.name}@${pkg.version}`,
          url: `https://www.npmjs.com/package/${pkg.name}`,
          snippet: pkg.description || '',
          domain: 'npmjs.com',
          source: 'npm',
        };
      });
      traceEnd('npm', query, startTime, { status: 'ok', resultCount: results.length });
      return results;
    } catch (err) {
      if (signal?.aborted) {
        traceEnd('npm', query, startTime, { status: 'aborted', resultCount: 0 });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        traceEnd('npm', query, startTime, { status: 'error', resultCount: 0, error: message });
      }
      // Re-throw: surface HTTP errors, network failures, and aborts —
      // execute.ts distinguishes aborts from real failures.
      throw err;
    }
  });
}