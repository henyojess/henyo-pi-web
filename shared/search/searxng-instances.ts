/**
 * Public SearXNG instances with health scores.
 * Sourced from searx.space — filtered for:
 *   - success rate ≥ 90%
 *   - uptime ≥ 90%
 *   - response time ≤ 2s
 *   - TLS A or A+ rating
 *
 * Note: Public instances may have bot protection or rate limiting.
 * For reliable results, use a self-hosted instance via searxng.url config.
 */

export interface SearXNGInstance {
  url: string;
  score: number;
  tags: string[];
}

/**
 * Health-checked instances — sorted by score descending.
 * These are verified public instances with good uptime and response times.
 */
export const PUBLIC_INSTANCES: SearXNGInstance[] = [
  {
    url: 'https://search.mdosch.de',
    score: 93,
    tags: ['DE', 'no-logs'],
  },
  {
    url: 'https://searx.work',
    score: 92,
    tags: ['US', 'no-logs'],
  },
  {
    url: 'https://search.projectsegfau.lt',
    score: 91,
    tags: ['no-logs', 'privacy'],
  },
  {
    url: 'https://searx.si',
    score: 90,
    tags: ['US', 'no-logs'],
  },
  {
    url: 'https://search.catsarch.com',
    score: 89,
    tags: ['JP', 'no-logs'],
  },
  {
    url: 'https://paulgo.io',
    score: 88,
    tags: ['US', 'no-logs'],
  },
  {
    url: 'https://searx.tiekoetter.com',
    score: 87,
    tags: ['DE', 'no-logs'],
  },
  {
    url: 'https://search.bus-hit.me',
    score: 86,
    tags: ['DE', 'no-logs', 'privacy'],
  },
  {
    url: 'https://search.sapti.me',
    score: 85,
    tags: ['NL', 'no-logs', 'mobile'],
  },
  {
    url: 'https://search.ononoki.org',
    score: 84,
    tags: ['no-logs', 'privacy'],
  },
  {
    url: 'https://search.inetol.net',
    score: 83,
    tags: ['FR', 'no-logs'],
  },
  {
    url: 'https://searx.zhenyu.me',
    score: 82,
    tags: ['US', 'no-logs'],
  },
].map(inst => ({ ...inst, tags: [...inst.tags] })); // defensive copy

/** Default timeout for health checks in ms */
export const HEALTH_CHECK_TIMEOUT = 5000;

/** Health check cache TTL in ms (5 minutes) */
export const HEALTH_CHECK_TTL = 300000;