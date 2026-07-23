import { pickRandom, delay, USER_AGENTS } from '../../user-agents';
import { enqueue } from '../queue';
import { PUBLIC_INSTANCES, type SearXNGInstance } from '../searxng-instances';
import { isInstanceHealthy, healthCheckInstance, getHealthyInstances } from '../searxng-health';
import { SearchResult, ProviderConfig } from './base';
import { shouldTrace, traceLog } from '../trace';

// ─── SearXNG Provider ────────────────────────────────────────────────────────

/**
 * Search via SearXNG with automatic instance fallback.
 * If a custom URL is provided, use it. Otherwise, iterate through bundled
 * public instances, skipping unhealthy ones.
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

    for (const instance of instances) {
      if (signal?.aborted) break;

      const result = await searchViaInstance(instance.url, query, signal);
      if (result.length > 0) {
        return result;
      }

      // Instance didn't return results — check health, retry if unhealthy
      if (!isInstanceHealthy(instance)) {
        const healthy = await healthCheckInstance(instance);
        if (!healthy) continue; // Skip unhealthy instances
      }
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
 * Search a single SearXNG instance.
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

    const res = await fetch(`${instanceUrl}/search?q=${encodeURIComponent(query)}&format=json`, {
      signal: controller.signal,
      headers: { 'User-Agent': pickRandom(USER_AGENTS) },
    });

    clearTimeout(timeoutId);

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
