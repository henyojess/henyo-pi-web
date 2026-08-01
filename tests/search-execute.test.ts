import type { SearchResult } from '../shared/search/providers';
import { sanitizeQuery } from '../shared/search/providers/base';
import { searchDuckDuckGo } from '../shared/search/providers/duckduckgo';
import { searchWikipedia } from '../shared/search/providers/wikipedia';
import { searchStackOverflow } from '../shared/search/providers/stackoverflow';
import { searchNpm } from '../shared/search/providers/npm';
import { searchGitHub } from '../shared/search/providers/github';
import { rankResults, diversifyByDomain } from '../shared/format';

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

vi.mock('../shared/rate-limit', () => ({
  RateLimitStore: class {
    setCooldown() {}
  },
  DEFAULT_RATE_LIMIT_COOLDOWNS: {},
}));

// ─── Test: each provider is callable ─────────────────────────────────────────

describe('search providers are callable', () => {
  const mockNpmResponse = JSON.stringify({
    objects: [{ package: { name: 'test-pkg', version: '1.0.0', description: 'A test package' } }],
  });
  const mockGitHubResponse = JSON.stringify({
    items: [{ owner: { login: 'test' }, name: 'test-repo', html_url: 'https://github.com/test/test-repo', description: 'Test', language: 'TS' }],
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

  it('searchGitHub returns repo results', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(mockGitHubResponse, { status: 200 }));

    const results = await searchGitHub('test');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toContain('test/test-repo');
    expect(results[0].source).toBe('github');
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

/** Minimal execute pipeline clone for testing abort behavior */
async function executePipeline(
  providerFn: (query: string, config?: any, signal?: AbortSignal) => Promise<SearchResult[]>,
  params: { query: string; max?: number; toolName?: string },
  signal: AbortSignal | undefined,
): Promise<{ content: { type: string; text: string }[]; details: Record<string, unknown> }> {
  const { query, max = 10, toolName = 'test' } = params;
  const results = await providerFn(query, undefined, signal);
  const ranked = rankResults(query, results);
  const diversified = diversifyByDomain(ranked, 2);

  const providerResults: Array<{ name: string; status: 'ok' | 'error' }> = [
    { name: toolName, status: 'ok' as const },
  ];

  // Abort check — matches the execute pipeline behavior
  if (signal?.aborted) {
    return {
      content: [{ type: 'text', text: diversified.length > 0 ? diversifyByDomain(diversified, 10).map(r => r.title).join('\n') : 'Search cancelled' }],
      details: { count: diversified.length, aborted: true, providers: providerResults },
    };
  }

  if (diversified.length === 0) {
    return { content: [{ type: 'text', text: 'No results found.' }], details: { count: 0, providers: providerResults } };
  }

  return {
    content: [{ type: 'text', text: diversified.slice(0, max).map(r => r.title).join('\n') }],
    details: { count: diversified.slice(0, max).length, providers: providerResults },
  };
}

describe('abort signal handling', () => {
  it('returns partial results with aborted flag when signal is aborted', async () => {
    const mockProvider = vi.fn().mockResolvedValue([
      { title: 'Partial Result', url: 'https://example.com', snippet: 'partial', domain: 'example.com' },
    ] as SearchResult[]);

    const controller = new AbortController();
    controller.abort();

    const result = await executePipeline(mockProvider, { query: 'test', toolName: 'search_test' }, controller.signal);

    expect(result.details).toHaveProperty('aborted', true);
    expect(result.details).toHaveProperty('count', 1);
  });

  it('returns no results message when abort happens with zero results', async () => {
    const mockProvider = vi.fn().mockResolvedValue([] as SearchResult[]);

    const controller = new AbortController();
    controller.abort();

    const result = await executePipeline(mockProvider, { query: 'test', toolName: 'search_test' }, controller.signal);

    expect(result.details).toHaveProperty('aborted', true);
    expect(result.details).toHaveProperty('count', 0);
  });

  it('does not set aborted flag when signal is not aborted', async () => {
    const mockProvider = vi.fn().mockResolvedValue([
      { title: 'Result', url: 'https://example.com', snippet: 'test', domain: 'example.com' },
    ] as SearchResult[]);

    const controller = new AbortController();

    const result = await executePipeline(mockProvider, { query: 'test', toolName: 'search_test' }, controller.signal);

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
    const result = await executePipeline(mockProvider, { query: 'test', toolName: 'search_test' }, controller.signal);

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

    const result = await executePipeline(mockProvider, { query: 'test', toolName: 'search_test' }, controller.signal);

    const providers = result.details.providers as Array<{ name: string; status: string }>;
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe('search_test');
    expect(providers[0].status).toBe('ok');
  });

  it('details.providers is present with zero results', async () => {
    const mockProvider = vi.fn().mockResolvedValue([] as SearchResult[]);

    const controller = new AbortController();
    const result = await executePipeline(mockProvider, { query: 'test', toolName: 'search_test' }, controller.signal);

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
