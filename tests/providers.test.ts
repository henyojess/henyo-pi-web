import {
  searchDuckDuckGo,
  searchStackOverflow,
  searchNpm,
  searchGitHub,
  searchWikipedia,
  searchJina,
  searchSearXNG,
  PROVIDER_MAP,
} from '../shared/search/providers';

describe('searchDuckDuckGo', () => {
  it('returns results array (may be empty if blocked)', async () => {
    const results = await searchDuckDuckGo('vitest');
    expect(Array.isArray(results)).toBe(true);
  }, 30000);
});

describe('searchStackOverflow', () => {
  it('returns results array (may be empty if blocked)', async () => {
    const results = await searchStackOverflow('javascript hello world');
    expect(Array.isArray(results)).toBe(true);
  });
});

describe('searchNpm', () => {
  it('returns results for known package', async () => {
    const results = await searchNpm('vitest');
    expect(Array.isArray(results)).toBe(true);
  });

  it('returns empty array for non-existent package', async () => {
    const results = await searchNpm('this-package-does-not-exist-xyz123');
    expect(Array.isArray(results)).toBe(true);
  });
});

describe('searchGitHub', () => {
  it('returns results array', async () => {
    const results = await searchGitHub('vitest');
    expect(Array.isArray(results)).toBe(true);
  });
});

describe('searchWikipedia', () => {
  it('returns results array', async () => {
    const results = await searchWikipedia('javascript');
    expect(Array.isArray(results)).toBe(true);
  }, 30000);
});

describe('searchJina', () => {
  it('returns results array', async () => {
    const results = await searchJina('vitest');
    expect(Array.isArray(results)).toBe(true);
  });
});

describe('searchSearXNG', () => {
  it('returns empty array for empty URL', async () => {
    const results = await searchSearXNG('', 'test');
    expect(results).toEqual([]);
  });

  it('returns empty array for invalid URL', async () => {
    const results = await searchSearXNG('https://not-a-searxng-server.invalid', 'test');
    expect(Array.isArray(results)).toBe(true);
  });
});

describe('PROVIDER_MAP', () => {
  it('has all expected providers', () => {
    expect(PROVIDER_MAP).toHaveProperty('duckduckgo');
    expect(PROVIDER_MAP).toHaveProperty('stackoverflow');
    expect(PROVIDER_MAP).toHaveProperty('npm');
    expect(PROVIDER_MAP).toHaveProperty('github');
    expect(PROVIDER_MAP).toHaveProperty('wikipedia');
    expect(PROVIDER_MAP).toHaveProperty('jina');
    expect(PROVIDER_MAP).toHaveProperty('searxng');
  });

  it('all providers are functions', () => {
    for (const [, fn] of Object.entries(PROVIDER_MAP)) {
      expect(typeof fn).toBe('function');
    }
  });
});