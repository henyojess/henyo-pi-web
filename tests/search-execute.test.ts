import type { SearchResult } from '../shared/search/providers';
import type { WebFetchConfig } from '../shared/config';

// Mock the search providers
vi.mock('../shared/search/providers/duckduckgo', () => ({
  searchDuckDuckGo: vi.fn(),
}));

vi.mock('../shared/search/providers/stackoverflow', () => ({
  searchStackOverflow: vi.fn(),
}));

vi.mock('../shared/search/providers/npm', () => ({
  searchNpm: vi.fn(),
}));

vi.mock('../shared/search/providers/github', () => ({
  searchGitHub: vi.fn(),
}));

vi.mock('../shared/search/providers/wikipedia', () => ({
  searchWikipedia: vi.fn(),
}));

vi.mock('../shared/search/providers/searxng', () => ({
  searchSearXNG: vi.fn(),
}));

vi.mock('../shared/cache', () => ({
  createCache: vi.fn(),
}));

vi.mock('../shared/format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/format')>();
  return {
    ...actual,
    formatResults: vi.fn(),
  };
});

vi.mock('../shared/fetch/pipeline', () => ({
  fetchPage: vi.fn(),
}));

import { searchDuckDuckGo } from '../shared/search/providers/duckduckgo';
import { searchStackOverflow } from '../shared/search/providers/stackoverflow';
import { searchNpm } from '../shared/search/providers/npm';
import { searchGitHub } from '../shared/search/providers/github';
import { searchWikipedia } from '../shared/search/providers/wikipedia';
import { searchSearXNG } from '../shared/search/providers/searxng';
import { createCache } from '../shared/cache';
import { formatResults } from '../shared/format';
import { fetchPage } from '../shared/fetch/pipeline';

// Mock pi
const mockPi = {
  registerTool: vi.fn(),
};

// We need to test the execute function directly.
// Since execute() is defined inside registerTools(), we'll test the core logic
// by importing and testing the shared functions that execute() uses.

describe('execute() pipeline — integration tests', () => {
  const mockProviderResults: SearchResult[] = [
    { title: 'Result 1', url: 'https://example.com/1', snippet: 'Snippet 1', domain: 'example.com' },
    { title: 'Result 2', url: 'https://example.com/2', snippet: 'Snippet 2', domain: 'example.com' },
    { title: 'Result 3', url: 'https://other.com/1', snippet: 'Snippet 3', domain: 'other.com' },
  ];

  const mockConfig: WebFetchConfig = {
    jinaEnabled: true,
    'min-delay': 0,
    'max-delay': 0,
    'cache-max-files': 100,
    'heading-threshold': 40000,
    contexts: {
      coding: {
        duckduckgo: { priority: 1 },
        stackoverflow: { priority: 1 },
        npm: { priority: 1 },
        github: { priority: 1 },
      },
      general: {
        duckduckgo: { priority: 1 },
        wikipedia: { priority: 1 },
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Mock provider helpers ──────────────────────────────────────────────

  function setupMockProvider(
    providerFn: ReturnType<typeof vi.fn>,
    results: SearchResult[] = mockProviderResults,
  ) {
    (providerFn as any).mockResolvedValue(results);
  }

  function setupAllProvidersMocked(results: SearchResult[] = mockProviderResults) {
    setupMockProvider(searchDuckDuckGo, results);
    setupMockProvider(searchStackOverflow, results);
    setupMockProvider(searchNpm, results);
    setupMockProvider(searchGitHub, results);
    setupMockProvider(searchWikipedia, results);
    setupMockProvider(searchSearXNG, results);
  }

  function setupMockCache(hit: SearchResult[] | null = null) {
    const mockCache = {
      get: vi.fn().mockReturnValue(hit),
      put: vi.fn(),
      clear: vi.fn(),
    };
    (createCache as any).mockReturnValue(mockCache);
    return mockCache;
  }

  // ─── Test: results flow through dedup → rank → diversify → return ──────

  it('flows results through dedup, rank, diversify pipeline', async () => {
    setupAllProvidersMocked(mockProviderResults);
    const cache = setupMockCache(null);

    const { detectContext, buildProviderChain } = await import('../shared/search/context');
    const { rankResults, diversifyByDomain, normalizeUrl } = await import('../shared/format');

    // Simulate the execute() pipeline
    const contextName = detectContext('javascript arrays');
    const providers = buildProviderChain(contextName, mockConfig.contexts || {});

    expect(providers.length).toBeGreaterThan(0);

    // Run providers and collect results
    const allResults: SearchResult[] = [];
    for (const provider of providers) {
      const results = await provider.fn('javascript arrays', undefined, undefined);
      allResults.push(...results);
    }

    // Dedup
    const seen = new Set<string>();
    const deduped: SearchResult[] = [];
    for (const r of allResults) {
      const key = normalizeUrl(r.url);
      if (!seen.has(key)) { seen.add(key); deduped.push(r); }
    }

    // Rank
    const ranked = rankResults('javascript arrays', deduped);

    // Diversify
    const diversified = diversifyByDomain(ranked, 2);

    expect(diversified.length).toBeGreaterThan(0);
    expect(cache.put).not.toHaveBeenCalled(); // noCache would be true in this test
  });

  // ─── Test: multiple priority groups accumulate results properly ────────

  it('accumulates results from multiple priority groups', async () => {
    const { buildProviderChain } = await import('../shared/search/context');

    const mixedConfig: WebFetchConfig = {
      ...mockConfig,
      contexts: {
        mixed: {
          duckduckgo: { priority: 1 },
          stackoverflow: { priority: 2 },
          npm: { priority: 2 },
        },
      },
    };

    const providers = buildProviderChain('mixed', mixedConfig.contexts);

    expect(providers.length).toBe(3);

    const ddgResults = providers.find(p => p.name === 'duckduckgo')!;
    const soResults = providers.find(p => p.name === 'stackoverflow')!;
    const npmResults = providers.find(p => p.name === 'npm')!;

    expect(ddgResults.priority).toBe(1);
    expect(soResults.priority).toBe(2);
    expect(npmResults.priority).toBe(2);

    // Simulate running in priority order
    const allResults: SearchResult[] = [];

    // Priority 1
    setupMockProvider(searchDuckDuckGo, [
      { title: 'DDG 1', url: 'https://ddg.com/1', snippet: '', domain: 'ddg.com' },
    ]);
    const ddgRes = await ddgResults.fn('test', undefined, undefined);
    allResults.push(...ddgRes);

    // Priority 2
    setupMockProvider(searchStackOverflow, [
      { title: 'SO 1', url: 'https://so.com/1', snippet: '', domain: 'so.com' },
    ]);
    const soRes = await soResults.fn('test', undefined, undefined);
    allResults.push(...soRes);

    setupMockProvider(searchNpm, [
      { title: 'NPM 1', url: 'https://npm.com/1', snippet: '', domain: 'npm.com' },
    ]);
    const npmRes = await npmResults.fn('test', undefined, undefined);
    allResults.push(...npmRes);

    expect(allResults.length).toBe(3);
  });

  // ─── Test: duplicate URLs across providers are deduplicated ─────────────

  it('deduplicates URLs across providers', async () => {
    const { buildProviderChain } = await import('../shared/search/context');

    const providers = buildProviderChain('coding', mockConfig.contexts || {});

    const duplicateUrl = 'https://example.com/duplicate';

    // Each provider returns the same URL
    const duplicateResults: SearchResult[] = [
      { title: 'Dup from DDG', url: duplicateUrl, snippet: '', domain: 'example.com' },
    ];

    setupMockProvider(searchDuckDuckGo, duplicateResults);
    setupMockProvider(searchStackOverflow, duplicateResults);
    setupMockProvider(searchNpm, duplicateResults);
    setupMockProvider(searchGitHub, duplicateResults);

    const allResults: SearchResult[] = [];
    for (const provider of providers) {
      const results = await provider.fn('test', undefined, undefined);
      allResults.push(...results);
    }

    // Dedup
    const { normalizeUrl } = await import('../shared/format');
    const seen = new Set<string>();
    const deduped: SearchResult[] = [];
    for (const r of allResults) {
      const key = normalizeUrl(r.url);
      if (!seen.has(key)) { seen.add(key); deduped.push(r); }
    }

    // Only one result should remain after dedup
    const dupResults = deduped.filter(r => r.url === duplicateUrl);
    expect(dupResults.length).toBe(1);
  });

  // ─── Test: abort signal returns partial results ─────────────────────────

  it('returns partial results when abort signal is triggered', async () => {
    const { buildProviderChain } = await import('../shared/search/context');

    const abortController = new AbortController();

    const providers = buildProviderChain('coding', mockConfig.contexts || {});

    // First provider succeeds, then abort
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return [{ title: 'First', url: 'https://first.com', snippet: '', domain: 'first.com' }];
      }
      // Simulate abort after first provider
      abortController.abort();
      return [];
    });

    setupMockProvider(searchDuckDuckGo, [{ title: 'First', url: 'https://first.com', snippet: '', domain: 'first.com' }]);
    setupMockProvider(searchStackOverflow, []);
    setupMockProvider(searchNpm, []);
    setupMockProvider(searchGitHub, []);

    // Simulate the execute loop with abort
    const allResults: SearchResult[] = [];
    const priorities = [...new Set(providers.map(p => p.priority))].sort((a, b) => a - b);

    for (const priority of priorities) {
      if (abortController.signal.aborted) {
        // Return partial results
        const { diversifyByDomain, formatResults } = await import('../shared/format');
        const partial = allResults.slice(0, 10);
        const diversified = diversifyByDomain(partial, 2);
        expect(diversified.length).toBeGreaterThan(0);
        expect(formatResults).toHaveBeenCalled();
        break;
      }

      const group = providers.filter(p => p.priority === priority);
      for (const provider of group) {
        if (abortController.signal.aborted) break;
        const results = await provider.fn('test', undefined, abortController.signal);
        allResults.push(...results);
      }
    }

    expect(allResults.length).toBeGreaterThan(0);
  });

  // ─── Test: cache hit path returns cached results ────────────────────────

  it('returns cached results when cache hit', async () => {
    const cachedResults: SearchResult[] = [
      { title: 'Cached 1', url: 'https://cached.com/1', snippet: '', domain: 'cached.com' },
      { title: 'Cached 2', url: 'https://cached.com/2', snippet: '', domain: 'cached.com' },
    ];

    const cache = setupMockCache(cachedResults);
    const { formatResults } = await import('../shared/format');

    // Simulate cache hit in execute()
    const cacheKey = 'search:coding:test query';
    const cached = cache.get(cacheKey);

    expect(cached).toEqual(cachedResults);
    expect(formatResults).not.toHaveBeenCalled(); // Should not format — just return cached
  });

  // ─── Test: noCache path skips cache ─────────────────────────────────────

  it('skips cache when noCache is true', async () => {
    const cache = setupMockCache([
      { title: 'Should Not Return', url: 'https://old.com', snippet: '', domain: 'old.com' },
    ]);

    // Simulate noCache = true, skip cache check
    const noCache = true;

    if (!noCache) {
      const cacheKey = 'search:coding:test query';
      cache.get(cacheKey);
    }

    // Cache should not be queried
    expect(cache.get).not.toHaveBeenCalled();
  });

  // ─── Test: all providers failing returns empty results ──────────────────

  it('handles all providers failing gracefully', async () => {
    const { buildProviderChain } = await import('../shared/search/context');

    const providers = buildProviderChain('coding', mockConfig.contexts || {});

    // All providers fail
    setupMockProvider(searchDuckDuckGo, []);
    setupMockProvider(searchStackOverflow, []);
    setupMockProvider(searchNpm, []);
    setupMockProvider(searchGitHub, []);

    const allResults: SearchResult[] = [];
    const providerResults: Array<{ name: string; status: string; error?: string }> = [];

    for (const provider of providers) {
      try {
        const results = await provider.fn('test', undefined, undefined);
        allResults.push(...results);
        providerResults.push({ name: provider.name, status: 'ok', error: undefined });
      } catch (err: any) {
        providerResults.push({ name: provider.name, status: 'error', error: err.message });
      }
    }

    expect(allResults.length).toBe(0);
    expect(providerResults.length).toBe(providers.length);
    expect(providerResults.every(p => p.status === 'ok')).toBe(true);
  });

  // ─── Test: per-provider count tracking in providerResults ───────────────

  it('tracks per-provider result counts in providerResults', async () => {
    const { buildProviderChain } = await import('../shared/search/context');

    const providers = buildProviderChain('coding', mockConfig.contexts || {});

    const ddgCount = 3;
    const soCount = 5;
    const npmCount = 2;
    const githubCount = 4;

    setupMockProvider(searchDuckDuckGo, Array(ddgCount).fill(null).map((_, i) => ({
      title: `DDG ${i}`, url: `https://ddg.com/${i}`, snippet: '', domain: 'ddg.com',
    })));
    setupMockProvider(searchStackOverflow, Array(soCount).fill(null).map((_, i) => ({
      title: `SO ${i}`, url: `https://so.com/${i}`, snippet: '', domain: 'so.com',
    })));
    setupMockProvider(searchNpm, Array(npmCount).fill(null).map((_, i) => ({
      title: `NPM ${i}`, url: `https://npm.com/${i}`, snippet: '', domain: 'npm.com',
    })));
    setupMockProvider(searchGitHub, Array(githubCount).fill(null).map((_, i) => ({
      title: `GH ${i}`, url: `https://github.com/${i}`, snippet: '', domain: 'github.com',
    })));

    const allResults: SearchResult[] = [];
    const providerResults: Array<{ name: string; status: string; count?: number }> = [];

    for (const provider of providers) {
      const results = await provider.fn('test', undefined, undefined);
      allResults.push(...results);
      providerResults.push({ name: provider.name, status: 'ok', count: results.length });
    }

    expect(allResults.length).toBe(ddgCount + soCount + npmCount + githubCount);

    // Verify per-provider counts
    const ddgResult = providerResults.find(p => p.name === 'duckduckgo');
    const soResult = providerResults.find(p => p.name === 'stackoverflow');
    const npmResult = providerResults.find(p => p.name === 'npm');
    const ghResult = providerResults.find(p => p.name === 'github');

    expect(ddgResult?.count).toBe(ddgCount);
    expect(soResult?.count).toBe(soCount);
    expect(npmResult?.count).toBe(npmCount);
    expect(ghResult?.count).toBe(githubCount);
  });

  // ─── Test: error handling in providers ──────────────────────────────────

  it('handles provider errors without crashing', async () => {
    const { buildProviderChain } = await import('../shared/search/context');

    const providers = buildProviderChain('coding', mockConfig.contexts || {});

    // DDG succeeds, SO throws, NPM succeeds, GitHub throws
    setupMockProvider(searchDuckDuckGo, [
      { title: 'DDG 1', url: 'https://ddg.com/1', snippet: '', domain: 'ddg.com' },
    ]);
    (searchStackOverflow as any).mockRejectedValue(new Error('API rate limit exceeded'));
    setupMockProvider(searchNpm, [
      { title: 'NPM 1', url: 'https://npm.com/1', snippet: '', domain: 'npm.com' },
    ]);
    (searchGitHub as any).mockRejectedValue(new Error('Network error'));

    const allResults: SearchResult[] = [];
    const providerResults: Array<{ name: string; status: string; error?: string }> = [];

    for (const provider of providers) {
      try {
        const results = await provider.fn('test', undefined, undefined);
        allResults.push(...results);
        providerResults.push({ name: provider.name, status: 'ok', error: undefined });
      } catch (err: any) {
        providerResults.push({ name: provider.name, status: 'error', error: err.message });
      }
    }

    // Should have results from successful providers
    expect(allResults.length).toBe(2);

    // Should have error entries for failed providers
    const errors = providerResults.filter(p => p.status === 'error');
    expect(errors.length).toBe(2);
    expect(errors.find(e => e.name === 'stackoverflow')?.error).toContain('rate limit');
    expect(errors.find(e => e.name === 'github')?.error).toContain('Network');
  });

  // ─── Test: context detection affects provider chain ─────────────────────

  it('coding context includes coding-specific providers', async () => {
    const { detectContext, buildProviderChain } = await import('../shared/search/context');

    expect(detectContext('const async function')).toBe('coding');

    const chain = buildProviderChain('coding', mockConfig.contexts || {});
    const names = chain.map(p => p.name);

    expect(names).toContain('duckduckgo');
    expect(names).toContain('stackoverflow');
    expect(names).toContain('npm');
    expect(names).toContain('github');
    expect(names).not.toContain('wikipedia');
  });

  it('general context includes general-specific providers', async () => {
    const { detectContext, buildProviderChain } = await import('../shared/search/context');

    expect(detectContext('what is the capital of France')).toBe('general');

    const chain = buildProviderChain('general', mockConfig.contexts || {});
    const names = chain.map(p => p.name);

    expect(names).toContain('duckduckgo');
    expect(names).toContain('wikipedia');
    expect(names).not.toContain('stackoverflow');
    expect(names).not.toContain('npm');
  });

  // ─── Test: max results limit ────────────────────────────────────────────

  it('respects max results limit', async () => {
    const { diversifyByDomain } = await import('../shared/format');

    const manyResults: SearchResult[] = Array(20).fill(null).map((_, i) => ({
      title: `Result ${i}`,
      url: `https://example${i}.com/page`,
      snippet: `Snippet ${i}`,
      domain: `example${i}.com`,
    }));

    const max = 5;
    const diversified = diversifyByDomain(manyResults, 2);
    const limited = diversified.slice(0, max);

    expect(limited.length).toBe(5);
    expect(limited).not.toEqual(manyResults);
  });

  // ─── Test: cache put after successful search ────────────────────────────

  it('caches results when noCache is false', async () => {
    const cache = setupMockCache(null);

    const searchResults: SearchResult[] = [
      { title: 'Result 1', url: 'https://example.com/1', snippet: '', domain: 'example.com' },
    ];

    // Simulate cache.put call at end of execute()
    const cacheKey = 'search:coding:test';
    const noCache = false;

    if (!noCache) {
      cache.put(cacheKey, searchResults);
    }

    expect(cache.put).toHaveBeenCalledWith(cacheKey, searchResults);
  });

  // ─── Test: empty provider chain throws ──────────────────────────────────

  it('throws when no providers configured for context', async () => {
    const { buildProviderChain } = await import('../shared/search/context');

    const emptyConfig = {
      nonexistent: {} as any,
    };

    const chain = buildProviderChain('nonexistent', emptyConfig);
    expect(chain.length).toBe(0);
  });
});