import { pickRandom, delay, USER_AGENTS, ACCEPT_LANGUAGES } from '../user-agents';
import { enqueue } from './queue';
import { RateLimitStore, DEFAULT_RATE_LIMIT_COOLDOWNS } from '../cache';
export { SearchResult } from './providers/base';
export { SearchProvider, ProviderDefinition, ProviderFn } from './providers/base';

// ─── CAPTCHA / rate-limit detection ──────────────────────────────────────────

const CAPTCHA_KEYWORDS = [
  'access denied', 'verify you are human', 'captcha', 'blocked', 'safety check',
];

function isCaptchaResponse(body: string): boolean {
  const lower = body.toLowerCase();
  return CAPTCHA_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Retry wrapper ───────────────────────────────────────────────────────────

const rateLimitStore = new RateLimitStore();

/**
 * Retry a function with exponential backoff on network errors.
 * Does NOT retry on rate limit/CAPTCHA — those are handled separately.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  providerName: string,
  maxRetries = 2,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      // Network errors: retry (fetch throws, timeout, no response)
      if (attempt < maxRetries) {
        const backoffMs = 2000 * Math.pow(2, attempt);
        await delay(backoffMs);
      }
    }
  }
  throw lastError;
}

// ─── Domain extraction ───────────────────────────────────────────────────────

export function extractDomain(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return undefined;
  }
}

// ─── DuckDuckGo ──────────────────────────────────────────────────────────────

export async function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  return enqueue('duckduckgo', async () => {
    const endpoints = [
      'https://html.duckduckgo.com/html/?q=',
      'https://duckduckgo.com/html/?q=',
    ];

    await delay(2000 + Math.random() * 3000);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    // Respect external abort signal
    signal?.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      controller.abort();
    }, { once: true });

    const opts = {
      signal: controller.signal,
      headers: {
        'User-Agent': pickRandom(USER_AGENTS),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': pickRandom(ACCEPT_LANGUAGES),
        'Referer': 'https://duckduckgo.com/',
      },
    };

    // Use withRetry for network error retries (2s → 4s, max 2 retries)
    let html: string | null = null;
    try {
      html = await withRetry(async () => {
        for (const base of endpoints) {
          const url = `${base}${encodeURIComponent(query)}`;
          const res = await fetch(url, opts);
          if (!res.ok) {
            // HTTP 429 = rate limited → set cooldown, throw to skip retries
            if (res.status === 429) {
              rateLimitStore.setCooldown('duckduckgo', DEFAULT_RATE_LIMIT_COOLDOWNS.duckduckgo);
              throw new Error('RATE_LIMITED');
            }
            continue;
          }
          const body = await res.text();
          // CAPTCHA detected → set cooldown, throw to skip retries
          if (isCaptchaResponse(body)) {
            rateLimitStore.setCooldown('duckduckgo', DEFAULT_RATE_LIMIT_COOLDOWNS.duckduckgo);
            throw new Error('CAPTCHA');
          }
          if (body) return body;
        }
        throw new Error('No endpoint succeeded');
      }, 'duckduckgo');
    } catch (err: any) {
      // RATE_LIMITED or CAPTCHA → return empty, no retry
      if (err.message === 'RATE_LIMITED' || err.message === 'CAPTCHA') {
        return [];
      }
      // Network error — withRetry already handled retries
      return [];
    }

    if (!html) return [];

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!bodyMatch) return [];
  const body = bodyMatch[1];

  if (body.includes('No results')) return [];

  const results: SearchResult[] = [];
  const resultDivRegex = /<div class="result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  let divMatch;

  while ((divMatch = resultDivRegex.exec(body)) !== null) {
    const divContent = divMatch[1];
    const titleMatch = divContent.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const title = titleMatch ? titleMatch[2].replace(/<[^>]+>/g, '').trim() : '';
    let redirectUrl = titleMatch ? titleMatch[1].trim() : '';

    let actualUrl = '';
    if (redirectUrl) {
      const rParam = new URLSearchParams(redirectUrl.includes('?') ? redirectUrl.split('?')[1] : '');
      actualUrl = rParam.get('uddg') || '';
      if (!actualUrl) {
        const pathMatch = redirectUrl.match(/\/l\/\?([^"]+)/);
        if (pathMatch) {
          actualUrl = decodeURIComponent(pathMatch[1].split('uddg=')[1]?.split('&')[0] || '');
        }
      }
    }
    if (!actualUrl) {
      const urlMatch = divContent.match(/class="result__url"[^>]*>([^<]+)<\/a>/i);
      actualUrl = urlMatch ? urlMatch[1].trim() : '';
    }

    const snippetMatch = divContent.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    if (title || actualUrl) {
      results.push({
        title: title || 'Untitled',
        url: actualUrl || redirectUrl || '',
        snippet,
        domain: extractDomain(actualUrl || redirectUrl || ''),
      });
    }
  }

  // "Did you mean" / instant answers
  const abstractMatch = body.match(/class="abstract"[^>]*>([\s\S]*?)<\/a>/i);
  if (abstractMatch) {
    const text = abstractMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) {
      results.unshift({
        title: 'Direct Answer',
        url: '—',
        snippet: text,
        domain: undefined,
      });
    }
  }

  return results;
  });
}

// ─── StackOverflow ───────────────────────────────────────────────────────────

class StackOverflowAPIError extends Error {
  constructor(message: string, public quotaRemaining: number) {
    super(message);
    this.name = 'StackOverflowAPIError';
  }
}

export async function searchStackOverflowAPI(query: string, apiKey?: string, signal?: AbortSignal): Promise<SearchResult[]> {
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

  // Check quota
  const quotaRemaining = (data as any).quota_remaining;
  if (quotaRemaining === 0) {
    throw new StackOverflowAPIError('StackOverflow API rate limited', 0);
  }

  const items = (data.items || []).slice(0, 10);
  return items.map((item: any) => {
    // Strip HTML tags except <code>
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

export async function searchStackOverflow(query: string, apiKey?: string, signal?: AbortSignal): Promise<SearchResult[]> {
  await delay(1500 + Math.random() * 2000);

  // Try API first
  try {
    return await searchStackOverflowAPI(query, apiKey, signal);
  } catch (err) {
    if (err instanceof StackOverflowAPIError) {
      // Rate limited — set cooldown and fall back to scraper
      rateLimitStore.setCooldown('stackoverflow', DEFAULT_RATE_LIMIT_COOLDOWNS.stackoverflow);
    }
    // Fall back to scraper
  }

  return searchStackOverflowScraper(query, signal);
}

async function searchStackOverflowScraper(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  await delay(1500 + Math.random() * 2000);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  // Respect external abort signal
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

// ─── npm ─────────────────────────────────────────────────────────────────────

export async function searchNpm(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
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
}

// ─── GitHub ──────────────────────────────────────────────────────────────────

export async function searchGitHub(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
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
}

// ─── Wikipedia ───────────────────────────────────────────────────────────────

export async function searchWikipedia(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  await delay(1000 + Math.random() * 1500);

  try {
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=10&format=json`,
      { signal, headers: { 'User-Agent': pickRandom(USER_AGENTS) } }
    );
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const [titles, urls, descriptions] = searchData.slice(1);

    if (!titles || titles.length === 0) return [];

    // Use batch API to fetch all extracts in one request
    const batchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles.join('|'))}&prop=extracts&exintro=true&exsentences=0&explaintext=true&format=json`,
      { signal, headers: { 'User-Agent': pickRandom(USER_AGENTS) } }
    );
    if (!batchRes.ok) {
      // Fallback: use descriptions only
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
        // Page not found in response
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
}

// ─── Jina Search ─────────────────────────────────────────────────────────────

export async function searchJina(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  await delay(1000 + Math.random() * 1500);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    // Respect external abort signal
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
}

// ─── SearXNG ─────────────────────────────────────────────────────────────────

export async function searchSearXNG(url: string, query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  if (!url) return [];

  await delay(1000 + Math.random() * 1500);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    // Respect external abort signal
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
}

// ─── Provider map ────────────────────────────────────────────────────────────

export const PROVIDER_MAP: Record<string, (...args: any[]) => Promise<SearchResult[]>> = {
  duckduckgo: searchDuckDuckGo,
  stackoverflow: searchStackOverflow,
  npm: searchNpm,
  github: searchGitHub,
  wikipedia: searchWikipedia,
  jina: searchJina,
  searxng: searchSearXNG,
};