import { pickRandom, delay, USER_AGENTS, ACCEPT_LANGUAGES } from '../../user-agents';
import { enqueue } from '../queue';
import { RateLimitStore, DEFAULT_RATE_LIMIT_COOLDOWNS } from '../../rate-limit';
import { SearchResult, ProviderConfig } from './base';

// ─── CAPTCHA / rate-limit detection ──────────────────────────────────────────

const CAPTCHA_KEYWORDS = [
  'access denied', 'verify you are human', 'captcha', 'blocked', 'safety check',
];

function isCaptchaResponse(body: string): boolean {
  const lower = body.toLowerCase();
  return CAPTCHA_KEYWORDS.some(kw => lower.includes(kw));
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

// ─── Retry wrapper ───────────────────────────────────────────────────────────

const rateLimitStore = new RateLimitStore();

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
      if (attempt < maxRetries) {
        const backoffMs = 2000 * Math.pow(2, attempt);
        await delay(backoffMs);
      }
    }
  }
  throw lastError;
}

// ─── DuckDuckGo Provider ─────────────────────────────────────────────────────

export async function searchDuckDuckGo(query: string, _config?: ProviderConfig, signal?: AbortSignal): Promise<SearchResult[]> {
  return enqueue('duckduckgo', async () => {
    const endpoints = [
      'https://html.duckduckgo.com/html/?q=',
      'https://duckduckgo.com/html/?q=',
    ];

    await delay(2000 + Math.random() * 3000);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
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

    let html: string | null = null;
    try {
      html = await withRetry(async () => {
        for (const base of endpoints) {
          const url = `${base}${encodeURIComponent(query)}`;
          const res = await fetch(url, opts);
          if (!res.ok) {
            if (res.status === 429) {
              rateLimitStore.setCooldown('duckduckgo', DEFAULT_RATE_LIMIT_COOLDOWNS.duckduckgo);
              throw new Error('RATE_LIMITED');
            }
            continue;
          }
          const body = await res.text();
          if (isCaptchaResponse(body)) {
            rateLimitStore.setCooldown('duckduckgo', DEFAULT_RATE_LIMIT_COOLDOWNS.duckduckgo);
            throw new Error('CAPTCHA');
          }
          if (body) return body;
        }
        throw new Error('No endpoint succeeded');
      }, 'duckduckgo');
    } catch (err: any) {
      if (err.message === 'RATE_LIMITED' || err.message === 'CAPTCHA') {
        return [];
      }
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