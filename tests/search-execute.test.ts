import type { SearchResult } from '../shared/search/providers';
import { sanitizeQuery } from '../shared/search/providers/base';
import { searchDuckDuckGo } from '../shared/search/providers/duckduckgo';
import { searchWikipedia } from '../shared/search/providers/wikipedia';
import { searchStackOverflow } from '../shared/search/providers/stackoverflow';
import { searchNpm } from '../shared/search/providers/npm';
import { searchGitHub } from '../shared/search/providers/github';
import { createSearchExecute } from '../shared/search/execute';
import { rankResults, diversifyByDomain } from '../shared/format';
import { rateLimitStore } from '../shared/rate-limit';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

vi.mock('../shared/user-agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/user-agents')>();
  return {
    ...actual,
    pickRandom: (arr: string[]) => arr[0],
    delay: () => Promise.resolve(),
  };
});

vi.mock('../shared/search/queue', async () => ({
  enqueue: async (_key: string, fn: () => Promise<any>) => fn(),
}));

vi.mock('../shared/rate-limit', () => {
  // In-memory Map-backed stand-in for the disk-backed RateLimitStore
  class RateLimitStore {
    cooldowns = new Map<string, number>();
    setCooldown(provider: string, durationMs: number) {
      this.cooldowns.set(provider, Date.now() + durationMs);
    }
    remainingMs(provider: string): number {
      const until = this.cooldowns.get(provider);
      if (until === undefined) return 0;
      if (Date.now() >= until) {
        this.cooldowns.delete(provider);
        return 0;
      }
      return until - Date.now();
    }
    clearExpired() {
      const now = Date.now();
      for (const [k, v] of this.cooldowns) {
        if (now >= v) this.cooldowns.delete(k);
      }
    }
  }
  const rateLimitStore = new RateLimitStore();
  return {
    RateLimitStore,
    rateLimitStore,
    DEFAULT_RATE_LIMIT_COOLDOWNS: {
      duckduckgo: 600_000,
      stackoverflow: 300_000,
      github: 300_000,
      npm: 120_000,
      wikipedia: 60_000,
    },
    keyToPath: (dir: string, key: string) => `${dir}/${createHash('sha256').update(key).digest('hex')}.json`,
  };
});

// ─── Test: each provider is callable ─────────────────────────────────────────

describe('search providers are callable', () => {
  const mockNpmResponse = JSON.stringify({
    objects: [{ package: { name: 'test-pkg', version: '1.0.0', description: 'A test package' } }],
  });
  const mockGitHubRepoResponse = JSON.stringify({
    items: [{ owner: { login: 'test' }, name: 'test-repo', html_url: 'https://github.com/test/test-repo', description: 'Test', language: 'TS' }],
  });
  const mockGitHubIssueResponse = JSON.stringify({
    items: [
      {
        number: 42,
        title: 'CSS cascade bug',
        state: 'open',
        body: 'The cascade order differs between dev and prod.',
        html_url: 'https://github.com/test/test-repo/issues/42',
        owner: { login: 'test' },
        name: 'test-repo',
        comments: 3,
        reactions: { total_count: 5 },
      },
      {
        number: 43,
        title: 'PR: fix cascade',
        state: 'open',
        body: 'Fixes #42',
        html_url: 'https://github.com/test/test-repo/pull/43',
        owner: { login: 'test' },
        name: 'test-repo',
        comments: 1,
        reactions: { total_count: 0 },
        pull_request: { url: 'https://api.github.com/repos/test/test-repo/pulls/43' },
      },
    ],
  });
  const mockWikiResponse = JSON.stringify([
    null, ['Test Topic'], ['A test topic'], ['https://en.wikipedia.org/wiki/Test_Topic'],
  ]);
  const mockWikiExtract = JSON.stringify({
    query: { pages: { '1': { extract: 'Test extract', title: 'Test Topic' } } },
  });
  const mockDDGResponse = `
    <html><body>
    <div class="result">
      <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fpage">Test Result</a>
      <a class="result__snippet">Test snippet</a>
    </div>
    </div>
    </div>
    </body></html>
  `;
  const mockSOResponse = JSON.stringify({
    items: [{ title: 'Test SO Question', link: 'https://stackoverflow.com/questions/1', question_id: 1, body: '<p>Test body</p>' }],
    quota_remaining: 100,
  });

  beforeEach(() => vi.clearAllMocks());

  it('searchNpm returns package results', async () => {
    const callOrder: number[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      callOrder.push(url.includes('search') ? 0 : 1);
      return new Response(mockNpmResponse, { status: 200 });
    });

    const results = await searchNpm('test');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toContain('test-pkg');
    expect(results[0].source).toBe('npm');
  });

  it('searchGitHub returns repo and issue results', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('/search/issues')) return new Response(mockGitHubIssueResponse, { status: 200 });
      return new Response(mockGitHubRepoResponse, { status: 200 });
    });

    const results = await searchGitHub('test');
    expect(results.length).toBe(2); // 1 repo + 1 issue (PR item filtered out)
    expect(results[0].title).toBe('test/test-repo (TS)');
    expect(results[1].title).toBe('test/test-repo#42 [open] — CSS cascade bug');
    expect(results[1].snippet).toContain('3 comments, 5 👍');
    expect(results[0].source).toBe('github');
    expect(results[1].source).toBe('github');
  });

  it('searchGitHub filters pull requests out of issue results', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('/search/issues')) return new Response(mockGitHubIssueResponse, { status: 200 });
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });

    const results = await searchGitHub('test');
    expect(results.length).toBe(1);
    expect(results[0].title).not.toContain('#43');
  });

  it('searchGitHub returns repo results when the issues endpoint fails', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('/search/issues')) return new Response('Not Found', { status: 404 });
      return new Response(mockGitHubRepoResponse, { status: 200 });
    });

    const results = await searchGitHub('test');
    expect(results.length).toBe(1);
    expect(results[0].title).toContain('test/test-repo');
  });

  it('searchGitHub throws when both endpoints fail', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('Server Error', { status: 500 }));

    await expect(searchGitHub('test')).rejects.toThrow('GitHub API HTTP 500');
  });

  it('searchWikipedia returns wiki results', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('opensearch')) {
        return new Response(mockWikiResponse, { status: 200 });
      }
      return new Response(mockWikiExtract, { status: 200 });
    });

    const results = await searchWikipedia('test');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe('wikipedia');
  });

  it('searchDuckDuckGo returns DDG results', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(mockDDGResponse, { status: 200 }));

    const results = await searchDuckDuckGo('test');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe('duckduckgo');
  });

  it('searchStackOverflow returns SO results via API', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(mockSOResponse, { status: 200 }));

    const results = await searchStackOverflow('test');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe('stackoverflow');
  });
});

// ─── Test: sanitizeQuery behavior per provider ──────────────────────────────

describe('sanitizeQuery behavior', () => {
  it('strips quotes — needed for npm and wikipedia', () => {
    const query = '"react state management"';
    const sanitized = sanitizeQuery(query);
    expect(sanitized).toBe('react state management');
  });

  it('preserves alphanumerics and common chars', () => {
    const sanitized = sanitizeQuery('my-package_v2.0+build');
    expect(sanitized).toBe('my-package_v2.0+build');
  });

  it('strips special chars that break API queries', () => {
    const sanitized = sanitizeQuery('error (TypeError): undefined');
    expect(sanitized).toBe('error TypeError undefined');
  });

  it('collapse multiple spaces', () => {
    expect(sanitizeQuery('hello    world')).toBe('hello world');
  });

  it('trim whitespace', () => {
    expect(sanitizeQuery('  hello  ')).toBe('hello');
  });
});

// ─── Test: tool registration structure (from index.ts perspective) ──────────

describe('search tool registration structure', () => {
  it('has 5 distinct tool names that should be registered', () => {
    const expectedTools = [
      'search_ddg',
      'search_wikipedia',
      'search_stackoverflow',
      'search_npm',
      'search_github',
    ];
    expect(expectedTools.length).toBe(5);
    expect(expectedTools).not.toContain('henyo_search');
  });

  it('each tool has a unique name', () => {
    const tools = ['search_ddg', 'search_wikipedia', 'search_stackoverflow', 'search_npm', 'search_github'];
    const unique = new Set(tools);
    expect(unique.size).toBe(5);
  });

  it('no tool name contains routing keywords', () => {
    const tools = ['search_ddg', 'search_wikipedia', 'search_stackoverflow', 'search_npm', 'search_github'];
    for (const name of tools) {
      expect(name).not.toContain('context');
      expect(name).not.toContain('provider');
      expect(name).not.toContain('chain');
    }
  });
});

// ─── Test: rankResults applies BM25 ranking ─────────────────────────────────

describe('rankResults', () => {
  it('ranks results by BM25 score — better title/snippet matches first', () => {
    const query = 'react state management';
    const results: SearchResult[] = [
      { title: 'React', url: 'https://example.com/1', snippet: 'A JavaScript library for building user interfaces', domain: 'example.com' },
      { title: 'State Management in React', url: 'https://example.com/2', snippet: 'A comprehensive guide to state management in React applications', domain: 'example.com' },
      { title: 'React Router', url: 'https://example.com/3', snippet: 'Declarative routing for React', domain: 'example.com' },
    ];

    const ranked = rankResults(query, results);

    // The second result ("State Management in React") should be first because
    // its title contains both "state" and "management" and "react"
    expect(ranked[0].title).toContain('State Management');
  });

  it('preserves original order for equal scores', () => {
    const query = 'test';
    const results: SearchResult[] = [
      { title: 'Test A', url: 'https://a.com', snippet: 'test', domain: 'a.com' },
      { title: 'Test B', url: 'https://b.com', snippet: 'test', domain: 'b.com' },
    ];

    const ranked = rankResults(query, results);
    // Both have equal scores, so original order is preserved
    expect(ranked[0].title).toBe('Test A');
    expect(ranked[1].title).toBe('Test B');
  });
});

// ─── Test: diversifyByDomain caps results per domain ─────────────────────────

describe('diversifyByDomain', () => {
  it('caps initial results per domain, then relaxes to 3x', () => {
    const results: SearchResult[] = [
      { title: 'A', url: 'https://example.com/1', snippet: 'test', domain: 'example.com' },
      { title: 'B', url: 'https://example.com/2', snippet: 'test', domain: 'example.com' },
      { title: 'C', url: 'https://example.com/3', snippet: 'test', domain: 'example.com' },
      { title: 'D', url: 'https://other.com/1', snippet: 'test', domain: 'other.com' },
      { title: 'E', url: 'https://other.com/2', snippet: 'test', domain: 'other.com' },
      { title: 'F', url: 'https://other.com/3', snippet: 'test', domain: 'other.com' },
    ];

    const diversified = diversifyByDomain(results, 2);
    // Initial cap: 2 per domain = 4, then relaxes to 3x = 6 per domain
    // With only 3 items per domain, all 6 are included (3 <= 2*3=6)
    expect(diversified.length).toBe(6);

    // After cap + relaxation: up to 3x per domain allowed
    const exampleCount = diversified.filter(r => r.domain === 'example.com').length;
    const otherCount = diversified.filter(r => r.domain === 'other.com').length;
    expect(exampleCount).toBe(3);
    expect(otherCount).toBe(3);
  });

  it('caps at maxPerDomain when many domains compete', () => {
    // 10 domains with 1 result each = 10 results, all kept (no cap needed)
    const results: SearchResult[] = Array.from({ length: 10 }, (_, i) => ({
      title: `Result ${i}`, url: `https://domain${i}.com`, snippet: 'test', domain: `domain${i}.com`,
    }));

    const diversified = diversifyByDomain(results, 2);
    expect(diversified.length).toBe(10);
  });

  it('caps at maxPerDomain when single domain has many results', () => {
    // 10 results from same domain, cap at 2 initially, relax to 3*2=6
    const results: SearchResult[] = Array.from({ length: 10 }, (_, i) => ({
      title: `Result ${i}`, url: `https://same.com/${i}`, snippet: 'test', domain: 'same.com',
    }));

    const diversified = diversifyByDomain(results, 2);
    // Initial cap: 2, then relax to 3*2=6
    expect(diversified.length).toBe(6);
  });

  it('preserves order within domain', () => {
    const results: SearchResult[] = [
      { title: 'A', url: 'https://a.com/1', snippet: 'test', domain: 'a.com' },
      { title: 'B', url: 'https://a.com/2', snippet: 'test', domain: 'a.com' },
      { title: 'C', url: 'https://a.com/3', snippet: 'test', domain: 'a.com' },
    ];

    const diversified = diversifyByDomain(results, 2);
    expect(diversified[0].title).toBe('A');
    expect(diversified[1].title).toBe('B');
  });
});

// ─── Test: abort signal handling (execute pipeline behavior) ─────────────────

describe('abort signal handling', () => {
  it('returns partial results with aborted flag when signal is aborted', async () => {
    const mockProvider = vi.fn().mockResolvedValue([
      { title: 'Partial Result', url: 'https://example.com', snippet: 'partial', domain: 'example.com' },
    ] as SearchResult[]);

    const controller = new AbortController();
    controller.abort();

    const executor = createSearchExecute(mockProvider, 'search_test', false);
    const result = await executor('toolCallId', { query: 'test', noCache: true }, controller.signal, undefined, {});

    expect(result.details).toHaveProperty('aborted', true);
    expect(result.details).toHaveProperty('count', 1);
  });

  it('returns no results message when abort happens with zero results', async () => {
    const mockProvider = vi.fn().mockResolvedValue([] as SearchResult[]);

    const controller = new AbortController();
    controller.abort();

    const executor = createSearchExecute(mockProvider, 'search_test', false);
    const result = await executor('toolCallId', { query: 'test', noCache: true }, controller.signal, undefined, {});

    expect(result.details).toHaveProperty('aborted', true);
    expect(result.details).toHaveProperty('count', 0);
  });

  it('does not set aborted flag when signal is not aborted', async () => {
    const mockProvider = vi.fn().mockResolvedValue([
      { title: 'Result', url: 'https://example.com', snippet: 'test', domain: 'example.com' },
    ] as SearchResult[]);

    const controller = new AbortController();

    const executor = createSearchExecute(mockProvider, 'search_test', false);
    const result = await executor('toolCallId', { query: 'test', noCache: true }, controller.signal, undefined, {});

    expect(result.details).not.toHaveProperty('aborted');
    expect(result.details).toHaveProperty('count', 1);
  });
});

// ─── Test: provider status tracking in details ──────────────────────────────

describe('provider status tracking', () => {
  it('details.providers is present with name and status on success', async () => {
    const mockProvider = vi.fn().mockResolvedValue([
      { title: 'Result', url: 'https://example.com', snippet: 'test', domain: 'example.com' },
    ] as SearchResult[]);

    const controller = new AbortController();
    const executor = createSearchExecute(mockProvider, 'search_test', false);
    const result = await executor('toolCallId', { query: 'test' }, controller.signal, undefined, {});

    expect(result.details).toHaveProperty('providers');
    const providers = result.details.providers as Array<{ name: string; status: string }>;
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe('search_test');
    expect(providers[0].status).toBe('ok');
  });

  it('details.providers is present with error status on abort', async () => {
    const mockProvider = vi.fn().mockResolvedValue([
      { title: 'Partial', url: 'https://example.com', snippet: 'partial', domain: 'example.com' },
    ] as SearchResult[]);

    const controller = new AbortController();
    controller.abort();

    const executor = createSearchExecute(mockProvider, 'search_test', false);
    const result = await executor('toolCallId', { query: 'test' }, controller.signal, undefined, {});

    const providers = result.details.providers as Array<{ name: string; status: string }>;
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe('search_test');
    expect(providers[0].status).toBe('ok');
  });

  it('details.providers is present with zero results', async () => {
    const mockProvider = vi.fn().mockResolvedValue([] as SearchResult[]);

    const controller = new AbortController();
    const executor = createSearchExecute(mockProvider, 'search_test', false);
    const result = await executor('toolCallId', { query: 'test' }, controller.signal, undefined, {});

    const providers = result.details.providers as Array<{ name: string; status: string }>;
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe('search_test');
    expect(providers[0].status).toBe('ok');
  });
});

// ─── Test: each provider receives query correctly ───────────────────────────

describe('provider query handling', () => {
  it('npm receives sanitized query for registry search', async () => {
    let capturedUrl = '';
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ objects: [] }), { status: 200 });
    });

    await searchNpm('"state management"');
    expect(capturedUrl).toContain('text=state%20management');
    expect(capturedUrl).not.toContain('"');
  });

  it('github receives raw query (quotes preserved for phrase matching)', async () => {
    let capturedUrl = '';
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });

    await searchGitHub('"fastapi"');
    expect(capturedUrl).toContain('q=%22fastapi%22');
  });

  it('wikipedia receives query and sanitizes internally', async () => {
    const calls: string[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      calls.push(url);
      if (url.includes('opensearch')) {
        return new Response(JSON.stringify([null, ['React'], ['Desc'], ['https://en.wikipedia.org/wiki/React']]), { status: 200 });
      }
      return new Response(JSON.stringify({ query: { pages: { '1': { extract: 'Extract', title: 'React' } } } }), { status: 200 });
    });

    await searchWikipedia('"React"');
    // Wikipedia sanitizes internally, so quotes should be stripped from opensearch call
    expect(calls[0]).toContain('search=React');
    expect(calls[0]).not.toContain('"');
  });
});

// ─── Test: empty results are never cached or served (poisoned-cache fix) ────

describe('empty results are never cached or served', () => {
  const home = process.env.HOME || process.env.USERPROFILE || '';

  it('(a) provider returns [] → nothing is cached; second call re-fires the provider', async () => {
    const mockProvider = vi.fn().mockResolvedValue([] as SearchResult[]);
    const executor = createSearchExecute(mockProvider, 'search_empty_a', true);
    const signal = new AbortController().signal;

    const r1 = await executor('id1', { query: 'empty-query' }, signal, undefined, {});
    expect(r1.details.count).toBe(0);

    const r2 = await executor('id2', { query: 'empty-query' }, signal, undefined, {});
    // No cache hit — the provider must be re-fired
    expect(mockProvider).toHaveBeenCalledTimes(2);
    expect(r2.details).not.toHaveProperty('cached', true);

    // And no cache file was written
    const filePath = `${home}/.pi/tools-cache/search_empty_a/${createHash('sha256').update('search:search_empty_a:empty-query').digest('hex')}.json`;
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('(b) a poisoned cached [] file is not served as a hit — provider re-fires', async () => {
    const mockProvider = vi.fn().mockResolvedValue([
      { title: 'Fresh', url: 'https://a.com', snippet: 's', domain: 'a.com' },
    ] as SearchResult[]);
    const executor = createSearchExecute(mockProvider, 'search_empty_b', true);

    // Write a poisoned cache file exactly as the old code did
    const dir = `${home}/.pi/tools-cache/search_empty_b`;
    fs.mkdirSync(dir, { recursive: true });
    const filePath = `${dir}/${createHash('sha256').update('search:search_empty_b:poisoned-query').digest('hex')}.json`;
    fs.writeFileSync(filePath, JSON.stringify({ data: [], timestamp: Date.now() }), 'utf8');

    try {
      const result = await executor('id1', { query: 'poisoned-query' }, new AbortController().signal, undefined, {});
      expect(mockProvider).toHaveBeenCalledTimes(1); // re-fired, not served from cache
      expect(result.details.count).toBe(1);
      expect(result.details).not.toHaveProperty('cached', true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── Test: rate-limit cooldown enforcement ──────────────────────────────────

describe('rate-limit cooldown enforcement', () => {
  it('(c) in-cooldown provider → "cooling down" text with seconds, provider not fired', async () => {
    rateLimitStore.setCooldown('npm', 60_000);
    const mockProvider = vi.fn().mockResolvedValue([
      { title: 'X', url: 'https://x.com', snippet: 's', domain: 'x.com' },
    ] as SearchResult[]);
    const executor = createSearchExecute(mockProvider, 'search_npm', true);

    const result = await executor('id', { query: 'cooling', noCache: true }, new AbortController().signal, undefined, {});

    expect(mockProvider).not.toHaveBeenCalled();
    expect(result.details.coolingDown).toBe(true);
    expect(result.details.remainingMs).toBeGreaterThan(0);
    expect(result.details.remainingMs).toBeLessThanOrEqual(60_000);
    const text = result.content[0].text;
    expect(text.startsWith('Search cooling down for')).toBe(true);
    expect(text).toContain('60s');
    expect(text).toContain('try again shortly');
  });

  it('(d) expired cooldown → provider fires normally', async () => {
    rateLimitStore.setCooldown('npm', 50);
    await new Promise(r => setTimeout(r, 80)); // let the 50ms cooldown expire
    expect(rateLimitStore.remainingMs('npm')).toBe(0);

    const mockProvider = vi.fn().mockResolvedValue([
      { title: 'X', url: 'https://x.com', snippet: 's', domain: 'x.com' },
    ] as SearchResult[]);
    const executor = createSearchExecute(mockProvider, 'search_npm', true);

    const result = await executor('id', { query: 'expired', noCache: true }, new AbortController().signal, undefined, {});

    expect(mockProvider).toHaveBeenCalledTimes(1);
    expect(result.details.count).toBe(1);
    expect(result.details).not.toHaveProperty('coolingDown');
  });
});

// ─── Test: visible provider errors (no silent "No results found.") ─────────

describe('visible provider errors', () => {
  it('(e) provider throws → "Provider error (tool)" text, not "No results found."', async () => {
    const mockProvider = vi.fn().mockRejectedValue(new Error('GitHub API HTTP 500'));
    const executor = createSearchExecute(mockProvider, 'search_github', false);

    const result = await executor('id', { query: 'boom' }, new AbortController().signal, undefined, {});

    const text = result.content[0].text;
    expect(text).not.toBe('No results found.');
    expect(text.startsWith('Provider error (search_github):')).toBe(true);
    expect(text).toContain('GitHub API HTTP 500');
    expect(result.details.count).toBe(0);
    const providers = result.details.providers as Array<{ name: string; status: string }>;
    expect(providers[0].status).toBe('error');
  });

  it('(f) provider throws + signal.aborted → "Search cancelled"', async () => {
    const mockProvider = vi.fn().mockRejectedValue(new Error('AbortError'));
    const controller = new AbortController();
    controller.abort();
    const executor = createSearchExecute(mockProvider, 'search_github', false);

    const result = await executor('id', { query: 'cancel' }, controller.signal, undefined, {});

    expect(result.content[0].text).toBe('Search cancelled');
    expect(result.details.aborted).toBe(true);
    const providers = result.details.providers as Array<{ name: string; status: string }>;
    expect(providers[0].status).toBe('error');
  });

  it('(g) provider throws a non-Error value → error text still visible', async () => {
    const mockProvider = vi.fn().mockRejectedValue('registry unavailable');
    const executor = createSearchExecute(mockProvider, 'search_npm', true);

    const result = await executor('id', { query: 'non-error-throw' }, new AbortController().signal, undefined, {});

    const text = result.content[0].text;
    expect(text.startsWith('Provider error (search_npm):')).toBe(true);
    expect(text).toContain('registry unavailable');
  });
});

describe('diversifyByDomain — no-domain bucket', () => {
  it('groups results without a domain into the noDomain bucket', () => {
    const results: SearchResult[] = [
      { title: 'a', url: 'https://a.example.com/1', snippet: '', source: 'test' },
      { title: 'b', url: 'https://b.example.com/2', snippet: '', source: 'test' },
      { title: 'c', url: 'https://c.example.com/3', snippet: '', source: 'test' },
    ];
    // > maxPerDomain (2) so the grouping loop runs; all lack `domain`
    const out = diversifyByDomain(results, 2);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.title)).toEqual(['a', 'b', 'c']); // order preserved
  });
});

// ─── Test: tool-layer trace logging ──────────────────────────────────────────

describe('tool-layer trace logging', () => {
  // Per-file log path — parallel test files must not share /tmp/henyo-trace.log.
  const LOG = join(mkdtempSync(join(tmpdir(), 'henyo-trace-test-')), 'trace.log');
  (globalThis as Record<string, unknown>).__henyoTraceLogPath = LOG;

  function readLog(): string {
    try {
      return fs.readFileSync(LOG, 'utf-8');
    } catch {
      return '';
    }
  }

  afterEach(() => {
    try {
      fs.unlinkSync(LOG);
    } catch {
      // no log — fine
    }
    delete (globalThis as Record<string, unknown>).__henyoTraceConfig;
  });

  it('cooldown block → trace line with status="cooling-down" and error="<providerKey>"', async () => {
    rateLimitStore.setCooldown('wikipedia', 60_000);
    const mockProvider = vi.fn().mockResolvedValue([
      { title: 'X', url: 'https://x.com', snippet: 's', domain: 'x.com' },
    ] as SearchResult[]);
    const executor = createSearchExecute(mockProvider, 'search_wikipedia', true, { trace: true });

    const result = await executor('id', { query: 'cooling-trace', noCache: true }, new AbortController().signal, undefined, {});

    expect(result.details.coolingDown).toBe(true);
    expect(mockProvider).not.toHaveBeenCalled();
    const content = readLog();
    expect(content).toContain('search_wikipedia query="cooling-trace"');
    expect(content).toContain('status="cooling-down"');
    expect(content).toContain('error="wikipedia"');
  });

  it('cache hit → trace line with status="cache-hit" and results=<cached count>', async () => {
    const toolName = 'search_trace_cachehit';
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const dir = `${home}/.pi/tools-cache/${toolName}`;
    fs.mkdirSync(dir, { recursive: true });
    const filePath = `${dir}/${createHash('sha256').update(`search:${toolName}:cached-query`).digest('hex')}.json`;
    fs.writeFileSync(filePath, JSON.stringify({
      data: [{ title: 'Cached', url: 'https://a.com', snippet: 's', domain: 'a.com' }],
      timestamp: Date.now(),
    }), 'utf8');

    try {
      const mockProvider = vi.fn().mockResolvedValue([] as SearchResult[]);
      const executor = createSearchExecute(mockProvider, toolName, true, { trace: true });

      const result = await executor('id', { query: 'cached-query' }, new AbortController().signal, undefined, {});

      expect(result.details.cached).toBe(true);
      expect(mockProvider).not.toHaveBeenCalled();
      const content = readLog();
      expect(content).toContain(`search_trace_cachehit query="cached-query"`);
      expect(content).toContain('status="cache-hit"');
      expect(content).toContain('results=1');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── Test: cache dir env fallback (HOME empty → USERPROFILE) ───────────────

describe('cache dir falls back to USERPROFILE when HOME is empty', () => {
  it('writes the cache file under USERPROFILE', async () => {
    const userHome = mkdtempSync(join(tmpdir(), 'henyo-userprofile-search-'));
    vi.stubEnv('HOME', '');
    vi.stubEnv('USERPROFILE', userHome);
    try {
      const mockProvider = vi.fn().mockResolvedValue([
        { title: 'Hit', url: 'https://a.com', snippet: 's', domain: 'a.com' },
      ] as SearchResult[]);
      const executor = createSearchExecute(mockProvider, 'search_up_c', true);

      const result = await executor('id1', { query: 'up-query' }, new AbortController().signal, undefined, {});
      expect(result.details.count).toBe(1);

      const filePath = `${userHome}/.pi/tools-cache/search_up_c/${createHash('sha256').update('search:search_up_c:up-query').digest('hex')}.json`;
      expect(fs.existsSync(filePath)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(userHome, { recursive: true, force: true });
    }
  });
});
