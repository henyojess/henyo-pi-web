import { pickRandom, delay, USER_AGENTS } from '../../user-agents';
import { enqueue } from '../queue';
import { SearchResult, ProviderConfig } from './base';

// ─── GitHub Provider ─────────────────────────────────────────────────────────

export async function searchGitHub(query: string, _config?: ProviderConfig, signal?: AbortSignal): Promise<SearchResult[]> {
  return enqueue('github', async () => {
    await delay(1500 + Math.random() * 2000);

    try {
      const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=10`, {
        signal,
        headers: { 'User-Agent': pickRandom(USER_AGENTS) },
      });

      if (!res.ok) return [];
      const data = await res.json();

      return (data.items || []).map((item: any) => ({
        title: `${item.owner.login}/${item.name} (${item.language || 'unknown'})`,
        url: item.html_url,
        snippet: item.description || 'No description',
        source: 'github',
      }));
    } catch {
      return [];
    }
  });
}