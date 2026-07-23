import { pickRandom, delay, USER_AGENTS } from '../../user-agents';
import { enqueue } from '../queue';
import { PUBLIC_INSTANCES, type SearXNGInstance } from '../searxng-instances';
import { isInstanceHealthy, healthCheckInstance, getHealthyInstances } from '../searxng-health';
import { SearchResult, ProviderConfig } from './base';
import { shouldTrace, traceLog } from '../trace';
import { storeCookies, getCookies } from '../cookie-jar';

// ─── SearXNG Provider ────────────────────────────────────────────────────────

/**
 * Search via SearXNG with automatic instance fallback and bot protection bypass.
 * Strategies:
 * 1. Cookie persistence between requests
 * 2. Automatic redirect following
 * 3. Bot protection detection (try next instance on failure)
 * 4. Request delay between instance attempts
 * 5. Proper headers (User-Agent, Accept, Accept-Language)
 */
export async function searchSearXNG(query: string, config?: ProviderConfig, signal?: AbortSignal): Promise<SearchResult[]> {
  const startTime = Date.now();
  const customUrl = config?.url as string | undefined;
  const traceConfig = (globalThis as any).__henyoTraceConfig;
  const traceEnabled = shouldTrace(traceConfig, 'searxng');

  // If custom URL provided (non-empty), use it (user's own instance)
  if (customUrl && customUrl.trim()) {
    return enqueue('searxng', async () => {
      await delay(500 + Math.random() * 1000);
      return searchViaInstance(customUrl, query, signal);
    });
  }

  // No custom URL provided (undefined) — use bundled public instances
  // Empty string is treated as "no search" for backward compatibility
  if (customUrl === undefined) {
    const instances = getHealthyInstances(PUBLIC_INSTANCES);
    const results: SearchResult[] = [];

    for (let i = 0; i < instances.length; i++) {
      if (signal?.aborted) break;

      const instance = instances[i]!;

      // Add delay between instance attempts to avoid rate limiting
      if (i > 0) {
        await delay(1000 + Math.random() * 2000);
      }

      const result = await searchViaInstance(instance.url, query, signal);
      if (result.length > 0) {
        // Success — return immediately
        if (traceEnabled) {
          traceLog({ provider: 'searxng', query, durationMs: Date.now() - startTime, resultCount: result.length, instance: instance.url });
        }
        return result;
      }

      // Instance didn't return results — mark as potentially unhealthy
      // Don't re-check health here — the instance might just not have results for this query
      // The health check will update on next use
    }

    if (traceEnabled) {
      traceLog({ provider: 'searxng', query, durationMs: Date.now() - startTime, resultCount: 0 });
    }
    return [];
  }

  // Empty URL — return empty for backward compatibility
  if (traceEnabled) {
    traceLog({ provider: 'searxng', query, durationMs: Date.now() - startTime, resultCount: 0 });
  }
  return [];
}

/**
 * Search a single SearXNG instance with bot protection bypass.
 */
async function searchViaInstance(
  instanceUrl: string,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      controller.abort();
    }, { once: true });

    // Build headers with cookies from previous requests
    const cookies = getCookies(instanceUrl);
    const cookieHeader = Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');

    const res = await fetch(`${instanceUrl}/search?q=${encodeURIComponent(query)}&format=json`, {
      signal: controller.signal,
      headers: {
        'User-Agent': pickRandom(USER_AGENTS),
        'Accept': 'application/json, text/*;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
      },
    });

    clearTimeout(timeoutId);

    // Store cookies from response (for bot protection bypass)
    const setCookieHeaders = res.headers.getSetCookie?.() || [];
    if (setCookieHeaders.length > 0) {
      storeCookies(instanceUrl, setCookieHeaders);
    }

    // Handle redirects (some instances redirect to HTTPS or add tracking params)
    if (res.redirected) {
      // Redirect was followed automatically by fetch
      // Check if we landed on a bot protection page
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        const text = await res.text();
        if (isBotProtectionPage(text)) {
          // Bot protection detected — clear cookies and try next instance
          return [];
        }
      }
    }

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

/**
 * Detect if an HTML response is a bot protection page.
 */
function isBotProtectionPage(html: string): boolean {
  const lowerHtml = html.toLowerCase();

  // Common bot protection indicators
  const indicators = [
    'making sure you\'re not a bot',
    'proof of work',
    'captcha',
    'cloudflare',
    'challenges.cloudflare.com',
    'just a moment',
    'checking your browser',
    'access denied',
    'verify you are human',
    'anubis',
    'within.website',
    'fingerprint',
    'fp=',
    'bot protection',
    'rate limit',
    'too many requests',
  ];

  return indicators.some(indicator => lowerHtml.includes(indicator));
}