import { pickRandom, delay, USER_AGENTS } from '../../user-agents';
import { enqueue } from '../queue';
import { RateLimitStore, DEFAULT_RATE_LIMIT_COOLDOWNS } from '../../rate-limit';
import { SearchResult, ProviderConfig } from './base';

// ─── StackOverflow API Error ─────────────────────────────────────────────────

export class StackOverflowAPIError extends Error {
  constructor(message: string, public quotaRemaining: number) {
    super(message);
    this.name = 'StackOverflowAPIError';
  }
}

// ─── StackOverflow API Search ────────────────────────────────────────────────

export async function searchStackOverflowAPI(query: string, config?: ProviderConfig, signal?: AbortSignal): Promise<SearchResult[]> {
  const apiKey = config?.apiKey as string | undefined;
  const params = new URLSearchParams({
    q: query,
    order: 'desc',
    sort: 'relevance',
    site: 'stackoverflow',
    filter: 'withbody',
    pagesize: '10',
  });

  let url = `https://api.stackexchange.com/2.3/search?${params}`;
  if (apiKey) {
    url += `&key=${apiKey}`;
  }

  const res = await fetch(url, {
    signal,
    headers: { 'User-Agent': pickRandom(USER_AGENTS) },
  });

  if (!res.ok) throw new Error(`StackOverflow API HTTP ${res.status}`);
  const data = await res.json();

  const quotaRemaining = (data as any).quota_remaining;
  if (quotaRemaining === 0) {
    throw new StackOverflowAPIError('StackOverflow API rate limited', 0);
  }

  const items = (data.items || []).slice(0, 10);
  return items.map((item: any) => {
    let body = item.body || '';
    body = body.replace(/<(?!\/?code[^>]*>)[^>]*>/g, '');
    body = body.replace(/<code[^>]*>([^<]*)<\/code>/g, '$1');

    return {
      title: item.title,
      url: item.link || `https://stackoverflow.com/questions/${item.question_id}`,
      snippet: body.substring(0, 300),
      source: 'stackoverflow',
      domain: 'stackoverflow.com',
    };
  });
}

// ─── StackOverflow Scraper ───────────────────────────────────────────────────

const rateLimitStore = new RateLimitStore();

async function searchStackOverflowScraper(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  await delay(1500 + Math.random() * 2000);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  signal?.addEventListener('abort', () => {
    clearTimeout(timeoutId);
    controller.abort();
  }, { once: true });

  const url = `https://stackoverflow.com/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent': pickRandom(USER_AGENTS),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!res.ok) return [];
  const html = await res.text();

  const results: SearchResult[] = [];
  const questions = html.match(/<div class="s-prose js-post-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g);
  if (!questions) return [];

  for (const question of questions.slice(0, 10)) {
    const titleMatch = question.match(/class="s-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (titleMatch) {
      let url = titleMatch[1];
      if (url.startsWith('/')) url = 'https://stackoverflow.com' + url;
      let title = titleMatch[2].replace(/<[^>]+>/g, ' ').trim();
      if (!title) continue;

      const snippetMatch = question.match(/<p[^>]*class="[^"]*"[^>]*>([\s\S]*?)<\/p>/);
      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200) : '';

      results.push({
        title: title.substring(0, 200),
        url: url.split('?')[0],
        snippet,
        source: 'stackoverflow',
        domain: 'stackoverflow.com',
      });
    }
  }

  return results;
}

// ─── StackOverflow Provider ──────────────────────────────────────────────────

export async function searchStackOverflow(query: string, config?: ProviderConfig, signal?: AbortSignal): Promise<SearchResult[]> {
  const apiKey = config?.apiKey as string | undefined;
  return enqueue('stackoverflow', async () => {
    await delay(1500 + Math.random() * 2000);

    try {
      return await searchStackOverflowAPI(query, config, signal);
    } catch (err) {
      if (err instanceof StackOverflowAPIError) {
        rateLimitStore.setCooldown('stackoverflow', DEFAULT_RATE_LIMIT_COOLDOWNS.stackoverflow);
      }
    }

    return searchStackOverflowScraper(query, signal);
  });
}