import { pickRandom, USER_AGENTS } from '../../user-agents';
import { enqueue } from '../queue';
import { rateLimitStore, DEFAULT_RATE_LIMIT_COOLDOWNS } from '../../rate-limit';
import { SearchResult, ProviderConfig } from './base';
import { traceEnd } from '../trace';

// ─── StackOverflow API Error ─────────────────────────────────────────────────

export class StackOverflowAPIError extends Error {
  constructor(message: string, public quotaRemaining: number) {
    super(message);
    this.name = 'StackOverflowAPIError';
  }
}

// ─── StackOverflow API Search ────────────────────────────────────────────────

export async function searchStackOverflowAPI(query: string, config?: ProviderConfig, signal?: AbortSignal): Promise<SearchResult[]> {
  const soApiKey = (config?.providers as { stackoverflow?: { 'api-key'?: string } } | undefined)?.stackoverflow?.['api-key'];
  const params = new URLSearchParams({
    q: query,
    intitle: query,
    order: 'desc',
    sort: 'relevance',
    site: 'stackoverflow',
    filter: 'withbody',
    pagesize: '10',
  });

  let url = `https://api.stackexchange.com/2.3/search?${params}`;
  if (soApiKey) {
    url += `&key=${soApiKey}`;
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
      score: typeof item.score === 'number' ? item.score : undefined,
      viewCount: typeof item.view_count === 'number' ? item.view_count : undefined,
    };
  });
}

// ─── StackOverflow Scraper ───────────────────────────────────────────────────

async function searchStackOverflowScraper(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `https://stackoverflow.com/search?q=${encodeURIComponent(query)}`;

  // Method 1: Try Jina Reader (handles Cloudflare)
  let jinaAvailable = false;
  try {
    const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
      signal,
      headers: {
        'User-Agent': pickRandom(USER_AGENTS),
        'Accept': 'text/plain',
        'X-Return-Format': 'text',
      },
    });

    if (jinaRes.ok) {
      jinaAvailable = true;
      const text = await jinaRes.text();
      const results = parseJinaHtml(text, url);
      if (results.length > 0) return results;
    }
  } catch {
    // Jina request failed (network error) — handled below
  }
  if (!jinaAvailable) {
    // Jina blocked or unreachable: the plain-fetch fallback below would
    // almost certainly be Cloudflare-blocked too. Surface a visible
    // provider error instead of a silent "No results found."
    throw new Error('StackOverflow scraper unavailable');
  }

  // Method 2: Plain fetch with HTML parsing (may be blocked by Cloudflare)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  signal?.addEventListener('abort', () => {
    clearTimeout(timeoutId);
    controller.abort();
  }, { once: true });

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': pickRandom(USER_AGENTS),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!res.ok) return [];
    const html = await res.text();
    return parseHtmlResults(html);
  } catch {
    return [];
  }
}

function parseJinaHtml(text: string, baseUrl: string): SearchResult[] {
  const results: SearchResult[] = [];

  // Jina returns extracted content; look for SO question patterns
  // Jina formats links as markdown: [title](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  const seen = new Set<string>();

  while ((match = linkRegex.exec(text)) !== null) {
    let title = match[1].replace(/<[^>]+>/g, ' ').trim();
    let linkUrl = match[2];

    if (!title || !linkUrl) continue;

    // Only include SO question links
    if (!linkUrl.includes('stackoverflow.com')) continue;

    // Normalize relative URLs
    if (linkUrl.startsWith('/')) linkUrl = 'https://stackoverflow.com' + linkUrl;

    // Deduplicate
    const cleanUrl = linkUrl.split('?')[0];
    if (seen.has(cleanUrl)) continue;
    seen.add(cleanUrl);

    if (title.length > 200) title = title.substring(0, 200);

    results.push({
      title,
      url: cleanUrl,
      snippet: '',
      source: 'stackoverflow',
      domain: 'stackoverflow.com',
    });

    if (results.length >= 10) break;
  }

  return results;
}

function parseHtmlResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // Match SO question blocks: div.s-prose.js-post-body containing a.s-link
  const questionRegex = /<div class="s-prose js-post-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  let questionMatch;
  const seen = new Set<string>();

  while ((questionMatch = questionRegex.exec(html)) !== null) {
    const block = questionMatch[1];

    // Extract link: <a class="s-link" href="/questions/...">Title</a>
    const linkRegex = /class="s-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/;
    const linkMatch = linkRegex.exec(block);
    if (!linkMatch) continue;

    let url = linkMatch[1];
    if (url.startsWith('/')) url = 'https://stackoverflow.com' + url;

    let title = linkMatch[2].replace(/<[^>]+>/g, ' ').trim();
    if (!title) continue;

    // Deduplicate
    const cleanUrl = url.split('?')[0];
    if (seen.has(cleanUrl)) continue;
    seen.add(cleanUrl);

    if (title.length > 200) title = title.substring(0, 200);

    // Extract snippet from <p> tags
    const snippetRegex = /<p[^>]*class="[^"]*"[^>]*>([\s\S]*?)<\/p>/;
    const snippetMatch = snippetRegex.exec(block);
    const snippet = snippetMatch
      ? snippetMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200)
      : '';

    results.push({
      title,
      url: cleanUrl,
      snippet,
      source: 'stackoverflow',
      domain: 'stackoverflow.com',
    });

    if (results.length >= 10) break;
  }

  return results;
}

// ─── StackOverflow Provider ──────────────────────────────────────────────────

export async function searchStackOverflow(query: string, signal?: AbortSignal, config?: ProviderConfig): Promise<SearchResult[]> {
  const startTime = Date.now();
  return enqueue('stackoverflow', async () => {
    try {
      const apiResults = await searchStackOverflowAPI(query, config, signal);
      traceEnd('stackoverflow', query, startTime, { status: 'ok', resultCount: apiResults.length });
      return apiResults;
    } catch (err) {
      // Trace the API-failure event (tags the cooldown-setting event).
      if (signal?.aborted) {
        traceEnd('stackoverflow', query, startTime, { status: 'aborted', resultCount: 0 });
      } else {
        let error: string;
        if (err instanceof StackOverflowAPIError) {
          // Only quota_remaining === 0 is thrown as StackOverflowAPIError
          error = 'so-api-rate-limited';
        } else if (err instanceof Error) {
          const httpMatch = /StackOverflow API HTTP (\d+)/.exec(err.message);
          error = httpMatch ? 'so-api-http-' + httpMatch[1] : err.message;
        } else {
          error = String(err);
        }
        traceEnd('stackoverflow', query, startTime, { status: 'error', resultCount: 0, error });
      }
      if (err instanceof StackOverflowAPIError) {
        rateLimitStore.setCooldown('stackoverflow', DEFAULT_RATE_LIMIT_COOLDOWNS.stackoverflow);
      }
    }

    // Fallback: scraper (Jina → plain fetch). Up to a 2nd provider-layer entry
    // per call — the API event above and this final outcome are distinct events.
    let results: SearchResult[];
    try {
      results = await searchStackOverflowScraper(query, signal);
    } catch (err) {
      if (signal?.aborted) {
        traceEnd('stackoverflow', query, startTime, { status: 'aborted', resultCount: 0 });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        traceEnd('stackoverflow', query, startTime, {
          status: 'error',
          resultCount: 0,
          error: message === 'StackOverflow scraper unavailable' ? 'scraper-unavailable' : message,
        });
      }
      throw err;
    }
    traceEnd('stackoverflow', query, startTime, { status: 'ok', resultCount: results.length });
    return results;
  });
}
