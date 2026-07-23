import type { SearXNGInstance } from './searxng-instances';
import { HEALTH_CHECK_TIMEOUT, HEALTH_CHECK_TTL } from './searxng-instances';

interface HealthStatus {
  healthy: boolean;
  responseTime: number;
  checkedAt: number;
  searchWorks: boolean;
}

/** In-memory health status cache */
const healthCache = new Map<string, HealthStatus>();

/**
 * Check if an instance is healthy (and cached status is fresh).
 * Returns true if the instance is known to be healthy and the check is within TTL.
 */
export function isInstanceHealthy(instance: SearXNGInstance): boolean {
  const cached = healthCache.get(instance.url);
  if (!cached) return true; // No cached status — try it
  if (Date.now() - cached.checkedAt > HEALTH_CHECK_TTL) return true; // Expired — retry
  return cached.healthy && cached.searchWorks;
}

/**
 * Health check a SearXNG instance by pinging its root and testing search.
 * Stores result in cache with TTL.
 */
export async function healthCheckInstance(instance: SearXNGInstance): Promise<boolean> {
  const startTime = Date.now();
  let searchWorks = false;

  try {
    // Test HTTP reachability
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);

    const res = await fetch(instance.url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'henyo-pi-web/health-check' },
    });

    clearTimeout(timeoutId);

    const responseTime = Date.now() - startTime;
    const reachable = res.ok && responseTime < HEALTH_CHECK_TIMEOUT;

    // Test actual search functionality
    if (reachable) {
      try {
        const searchRes = await fetch(
          `${instance.url}/search?q=test&format=json`,
          {
            signal: AbortSignal.timeout(5000),
            headers: { 'User-Agent': 'henyo-pi-web/health-check' },
          },
        );
        if (searchRes.ok) {
          const data = await searchRes.json();
          searchWorks = typeof data === 'object' && data !== null;
        }
      } catch {
        // Search test failed — instance may have bot protection
        searchWorks = false;
      }
    }

    const healthy = reachable && responseTime < HEALTH_CHECK_TIMEOUT;

    healthCache.set(instance.url, {
      healthy,
      responseTime,
      checkedAt: Date.now(),
      searchWorks,
    });

    return healthy && searchWorks;
  } catch {
    healthCache.set(instance.url, {
      healthy: false,
      responseTime: Date.now() - startTime,
      checkedAt: Date.now(),
      searchWorks: false,
    });
    return false;
  }
}

/**
 * Get healthy instances, filtering out unhealthy ones from the cache.
 * Returns instances sorted by score (highest first).
 */
export function getHealthyInstances(instances: SearXNGInstance[]): SearXNGInstance[] {
  return instances
    .filter(inst => isInstanceHealthy(inst))
    .sort((a, b) => b.score - a.score);
}

/**
 * Clear the health cache (useful for forcing a refresh).
 */
export function clearHealthCache(): void {
  healthCache.clear();
}