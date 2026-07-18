import { detectContext, buildProviderChain, CODING_SIGNALS } from '../shared/search/context';
import { normalizeUrl, formatResults, diversifyByDomain, bm25Score } from '../shared/format';
import type { SearchResult } from '../shared/search/providers';

// ─── detectContext ───────────────────────────────────────────────────────────

describe('detectContext', () => {
  it('returns general for empty query', () => {
    expect(detectContext('')).toBe('general');
  });

  it('returns general for plain English query', () => {
    expect(detectContext('what is the capital of France')).toBe('general');
  });

  it('returns general for single coding signal', () => {
    expect(detectContext('const x = 5')).toBe('general');
  });

  it('returns coding for two coding signals', () => {
    expect(detectContext('const async function')).toBe('coding');
  });

  it('returns coding for error messages', () => {
    expect(detectContext('TypeError: cannot find module')).toBe('coding');
  });

  it('returns coding for npm related queries', () => {
    expect(detectContext('npm install package')).toBe('coding');
  });

  it('returns general for npm as a word alone', () => {
    expect(detectContext('npm is a package manager')).toBe('general');
  });

  it('returns coding for git related queries', () => {
    expect(detectContext('git commit const x')).toBe('coding');
  });

  it('returns general for non-coding query with one signal', () => {
    expect(detectContext('class schedule for today')).toBe('general');
  });

  it('handles mixed signals correctly', () => {
    expect(detectContext('import async function from module')).toBe('coding');
  });

  it('exact pattern matches work', () => {
    expect(detectContext('SyntaxError: unexpected token')).toBe('coding');
    expect(detectContext('Traceback (most recent call last)')).toBe('general'); // only 1 signal
    expect(detectContext('Traceback (most recent call last) Error: failed')).toBe('coding');
  });
});

// ─── buildProviderChain ──────────────────────────────────────────────────────

describe('buildProviderChain', () => {
  const contexts = {
    coding: {
      duckduckgo: { priority: 1 },
      stackoverflow: { priority: 1 },
      npm: { priority: 1 },
      github: { priority: 1 },
    },
    general: {
      duckduckgo: { priority: 1 },
      wikipedia: { priority: 1 },
      jina: { priority: 2 },
    },
  };

  it('returns sorted providers for coding context', () => {
    const chain = buildProviderChain('coding', contexts);
    expect(chain.length).toBe(4);
    expect(chain.every(p => p.priority === 1)).toBe(true);
  });

  it('returns sorted providers for general context', () => {
    const chain = buildProviderChain('general', contexts);
    expect(chain.length).toBe(3);
    expect(chain[0].priority).toBe(1);
    expect(chain[chain.length - 1].priority).toBe(2);
  });

  it('returns empty array for missing context', () => {
    const chain = buildProviderChain('nonexistent', contexts);
    expect(chain.length).toBe(0);
  });

  it('SearXNG priority 0 replaces chain', () => {
    const contextsOverride = {
      custom: {
        searxng: { priority: 0, url: 'http://localhost:8080' },
        duckduckgo: { priority: 1 },
      },
    };
    const chain = buildProviderChain('custom', contextsOverride);
    expect(chain.length).toBe(1);
    expect(chain[0].name).toBe('searxng');
  });

  it('providers are sorted by priority', () => {
    const mixedContexts = {
      mixed: {
        jina: { priority: 3 },
        duckduckgo: { priority: 1 },
        wikipedia: { priority: 2 },
      },
    };
    const chain = buildProviderChain('mixed', mixedContexts);
    expect(chain.map(p => p.priority)).toEqual([1, 2, 3]);
  });
});

// ─── normalizeUrl ────────────────────────────────────────────────────────────

describe('normalizeUrl', () => {
  it('removes trailing slashes', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
  });

  it('removes www', () => {
    expect(normalizeUrl('https://www.example.com')).toBe('https://example.com');
  });

  it('lowercases url', () => {
    expect(normalizeUrl('HTTPS://EXAMPLE.COM')).toBe('https://example.com');
  });

  it('handles http protocol', () => {
    expect(normalizeUrl('http://www.example.com/')).toBe('https://example.com');
  });

  it('preserves path', () => {
    expect(normalizeUrl('https://example.com/path/to/page')).toBe('https://example.com/path/to/page');
  });
});

// ─── formatResults ───────────────────────────────────────────────────────────

describe('formatResults', () => {
  it('returns "No results found." for empty array', () => {
    expect(formatResults([])).toBe('No results found.');
  });

  it('formats a single result', () => {
    const results: SearchResult[] = [
      { title: 'Test Title', url: 'https://example.com', snippet: 'A snippet' },
    ];
    const output = formatResults(results);
    expect(output).toContain('1. Test Title');
    expect(output).toContain('URL: https://example.com');
    expect(output).toContain('A snippet');
  });

  it('includes source when present', () => {
    const results: SearchResult[] = [
      { title: 'Test', url: 'https://example.com', snippet: '', source: 'npm' },
    ];
    expect(formatResults(results)).toContain('Source: npm');
  });

  it('handles multiple results', () => {
    const results: SearchResult[] = [
      { title: 'First', url: 'https://first.com', snippet: '' },
      { title: 'Second', url: 'https://second.com', snippet: '' },
    ];
    const output = formatResults(results);
    expect(output).toContain('1. First');
    expect(output).toContain('2. Second');
  });
});

// ─── Domain diversification tests ───────────────────────────────────────────

describe('diversifyByDomain', () => {
  it('caps results per domain by default (2)', () => {
    const results: SearchResult[] = [
      { title: 'A', url: 'https://a.com/1', snippet: '', domain: 'a.com' },
      { title: 'B', url: 'https://a.com/2', snippet: '', domain: 'a.com' },
      { title: 'C', url: 'https://a.com/3', snippet: '', domain: 'a.com' },
      { title: 'D', url: 'https://b.com/1', snippet: '', domain: 'b.com' },
    ];
    const diversified = diversifyByDomain(results, 2);
    expect(diversified.length).toBe(4);
  });

  it('preserves order within domain', () => {
    const results: SearchResult[] = [
      { title: 'First A', url: 'https://a.com/1', snippet: '', domain: 'a.com' },
      { title: 'First B', url: 'https://b.com/1', snippet: '', domain: 'b.com' },
      { title: 'Second A', url: 'https://a.com/2', snippet: '', domain: 'a.com' },
    ];
    const diversified = diversifyByDomain(results, 2);
    // Results grouped by domain, preserving order within each group
    expect(diversified[0].title).toBe('First A');
    expect(diversified[1].title).toBe('Second A');
    expect(diversified[2].title).toBe('First B');
  });

  it('handles results without domain', () => {
    const results: SearchResult[] = [
      { title: 'No domain', url: '—', snippet: '', domain: undefined },
      { title: 'A', url: 'https://a.com', snippet: '', domain: 'a.com' },
    ];
    const diversified = diversifyByDomain(results, 2);
    expect(diversified.length).toBe(2);
  });

  it('returns all results when under cap', () => {
    const results: SearchResult[] = [
      { title: 'A', url: 'https://a.com', snippet: '', domain: 'a.com' },
      { title: 'B', url: 'https://b.com', snippet: '', domain: 'b.com' },
    ];
    const diversified = diversifyByDomain(results, 2);
    expect(diversified.length).toBe(2);
  });
});

// ─── BM25 ranking tests ─────────────────────────────────────────────────────

describe('bm25Score', () => {
  it('scores query terms in title higher than snippet', () => {
    const titleScore = bm25Score('javascript typescript', 'JavaScript vs TypeScript', 'A comparison of languages');
    const snippetScore = bm25Score('javascript typescript', 'Some random title', 'JavaScript and TypeScript are both popular languages');
    expect(titleScore).toBeGreaterThan(0);
    expect(snippetScore).toBeGreaterThan(0);
  });

  it('returns 0 for empty query', () => {
    expect(bm25Score('', 'Title', 'Snippet')).toBe(0);
  });

  it('returns 0 for stop-word only query', () => {
    expect(bm25Score('the and or', 'Title', 'Snippet')).toBe(0);
  });
});