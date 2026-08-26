import { pickRandom, USER_AGENTS } from '../../user-agents';
import { enqueue } from '../queue';
import { rateLimitStore, DEFAULT_RATE_LIMIT_COOLDOWNS } from '../../rate-limit';
import { SearchResult } from './base';

// ─── GitHub Provider ─────────────────────────────────────────────────────────

export async function searchGitHub(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  return enqueue('github', async () => {
    try {
      const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=10`, {
        signal,
        headers: { 'User-Agent': pickRandom(USER_AGENTS) },
      });

      if (!res.ok) {
        if (res.status === 403 || res.status === 429) {
          rateLimitStore.setCooldown('github', DEFAULT_RATE_LIMIT_COOLDOWNS.github);
        }
        throw new Error(`GitHub API HTTP ${res.status}`);
      }
      const data = await res.json();

      return (data.items || []).map((item: any) => ({
        title: `${item.owner.login}/${item.name} (${item.language || 'unknown'})`,
        url: item.html_url,
        snippet: item.description || 'No description',
        domain: 'github.com',
        source: 'github',
      }));
    } catch (err) {
      // Re-throw: surface HTTP errors, network failures, and aborts —
      // execute.ts distinguishes aborts from real failures.
      throw err;
    }
  });
}