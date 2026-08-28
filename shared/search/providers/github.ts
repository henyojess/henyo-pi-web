import { pickRandom, USER_AGENTS } from '../../user-agents';
import { enqueue } from '../queue';
import { rateLimitStore, DEFAULT_RATE_LIMIT_COOLDOWNS } from '../../rate-limit';
import { SearchResult } from './base';
import { traceEnd } from '../trace';

// ─── GitHub Provider ─────────────────────────────────────────────────────────
// Searches the Search API's repositories and issues endpoints in parallel and
// merges the results (PRs are excluded from the issue side). If one endpoint
// fails, the other's results are still returned — a rate-limited endpoint also
// sets the provider cooldown. Both failing is a hard error.

function mapRepo(item: any): SearchResult {
  return {
    title: `${item.owner.login}/${item.name} (${item.language || 'unknown'})`,
    url: item.html_url,
    snippet: item.description || 'No description',
    domain: 'github.com',
    source: 'github',
  };
}

function repoFromHtmlUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname !== 'github.com' && !u.hostname.endsWith('.github.com')) return '';
    const [owner, name] = u.pathname.split('/').filter(Boolean);
    return owner && name ? `${owner}/${name}` : '';
  } catch {
    return '';
  }
}

function mapIssue(item: any): SearchResult | null {
  // The search/issues endpoint also returns pull requests — exclude them
  if (item.pull_request) return null;
  // Issue items don't carry top-level owner/name — derive the repo from the URL
  const repo =
    repoFromHtmlUrl(item.html_url) ||
    `${item.owner?.login ?? 'unknown'}/${item.name ?? 'unknown'}`;
  const body = (item.body || '').replace(/\s+/g, ' ').trim();
  const stats = `${item.comments ?? 0} comments, ${item.reactions?.total_count ?? 0} 👍`;
  const excerpt = body ? `${body.slice(0, 160)}${body.length > 160 ? '…' : ''}` : '';
  return {
    title: `${repo}#${item.number} [${item.state}] — ${item.title}`,
    url: item.html_url,
    snippet: excerpt ? `${excerpt} (${stats})` : stats,
    domain: 'github.com',
    source: 'github',
  };
}

function rejectedReason(outcome: PromiseSettledResult<unknown>): unknown {
  return outcome.status === 'rejected' ? outcome.reason : undefined;
}

export async function searchGitHub(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const startTime = Date.now();
  return enqueue('github', async () => {
    // One call per endpoint; 403/429 sets the provider cooldown
    const call = async (endpoint: 'repositories' | 'issues') => {
      const res = await fetch(
        `https://api.github.com/search/${endpoint}?q=${encodeURIComponent(query)}&per_page=10`,
        {
          signal,
          headers: { 'User-Agent': pickRandom(USER_AGENTS) },
        },
      );

      if (!res.ok) {
        if (res.status === 403 || res.status === 429) {
          rateLimitStore.setCooldown('github', DEFAULT_RATE_LIMIT_COOLDOWNS.github);
        }
        throw new Error(`GitHub API HTTP ${res.status}`);
      }
      return res.json();
    };

    try {
      const [repoOutcome, issueOutcome] = await Promise.allSettled([
        call('repositories'),
        call('issues'),
      ]);

      if (signal?.aborted) {
        const reason = rejectedReason(repoOutcome) ?? rejectedReason(issueOutcome);
        throw reason instanceof Error ? reason : new Error('Aborted');
      }

      const results: SearchResult[] = [];
      let failures = 0;
      const settle = (outcome: PromiseSettledResult<any>, map: (item: any) => SearchResult | null) => {
        if (outcome.status === 'rejected') {
          failures++;
          return;
        }
        for (const item of outcome.value.items || []) {
          const r = map(item);
          if (r) results.push(r);
        }
      };
      settle(repoOutcome, mapRepo);
      settle(issueOutcome, mapIssue);

      if (failures === 2) {
        // Both failed — surface the repositories error (existing error path)
        throw rejectedReason(repoOutcome) instanceof Error
          ? rejectedReason(repoOutcome)
          : new Error('GitHub API search failed');
      }

      traceEnd('github', query, startTime, {
        status: 'ok',
        resultCount: results.length,
        ...(failures > 0 ? { partial: true } : {}),
      });
      return results;
    } catch (err) {
      if (signal?.aborted) {
        traceEnd('github', query, startTime, { status: 'aborted', resultCount: 0 });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        traceEnd('github', query, startTime, { status: 'error', resultCount: 0, error: message });
      }
      // Re-throw: surface HTTP errors, network failures, and aborts —
      // execute.ts distinguishes aborts from real failures.
      throw err;
    }
  });
}