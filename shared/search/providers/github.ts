import { pickRandom, USER_AGENTS } from '../../user-agents';
import { enqueue } from '../queue';
import { rateLimitStore, DEFAULT_RATE_LIMIT_COOLDOWNS } from '../../rate-limit';
import { SearchResult } from './base';
import { traceEnd } from '../trace';

// ─── GitHub Provider ─────────────────────────────────────────────────────────

export async function searchGitHub(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const startTime = Date.now();
  return enqueue('github', async () => {
    let cooldownReason: string | undefined;
    try {
      const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=10`, {
        signal,
        headers: { 'User-Agent': pickRandom(USER_AGENTS) },
      });

      if (!res.ok) {
        if (res.status === 403 || res.status === 429) {
          rateLimitStore.setCooldown('github', DEFAULT_RATE_LIMIT_COOLDOWNS.github);
          cooldownReason = 'http-' + res.status;
        }
        throw new Error(`GitHub API HTTP ${res.status}`);
      }
      const data = await res.json();

      const results = (data.items || []).map((item: any) => ({
        title: `${item.owner.login}/${item.name} (${item.language || 'unknown'})`,
        url: item.html_url,
        snippet: item.description || 'No description',
        domain: 'github.com',
        source: 'github',
      }));
      traceEnd('github', query, startTime, { status: 'ok', resultCount: results.length });
      return results;
    } catch (err) {
      if (signal?.aborted) {
        traceEnd('github', query, startTime, { status: 'aborted', resultCount: 0 });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        traceEnd('github', query, startTime, { status: 'error', resultCount: 0, error: cooldownReason ?? message });
      }
      // Re-throw: surface HTTP errors, network failures, and aborts —
      // execute.ts distinguishes aborts from real failures.
      throw err;
    }
  });
}