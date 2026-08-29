import { describe, it, expect } from 'vitest';
import { bm25Score, rankResults, diversifyByDomain, formatResults, normalizeUrl } from '../shared/format';
import type { SearchResult } from '../shared/search/providers';

const mk = (over: Partial<SearchResult> = {}): SearchResult => ({
  title: 'T',
  url: 'https://example.com/x',
  snippet: '',
  domain: 'example.com',
  source: 'test',
  ...over,
});

describe('normalizeUrl', () => {
  it('lowercases, strips trailing slashes, and canonicalizes www hosts', () => {
    expect(normalizeUrl('HTTPS://WWW.Example.COM/a/b/')).toBe('https://example.com/a/b');
    expect(normalizeUrl('http://example.com/x/')).toBe('http://example.com/x');
    expect(normalizeUrl('example.com/plain')).toBe('example.com/plain');
  });
});

describe('bm25Score', () => {
  it('returns 0 for a stopword-only query', () => {
    expect(bm25Score('the and of', 'anything goes', '')).toBe(0);
  });

  it('treats a query term absent from the document as df=0', () => {
    // 'omega' is absent from title+snippet → docFreq 0 side (L39 false branch)
    const withMatch = bm25Score('alpha omega', 'alpha is here', 'more alpha');
    const without = bm25Score('omega', 'alpha is here', 'more alpha');
    expect(withMatch).toBeGreaterThan(0);
    expect(without).toBe(0); // the absent term contributes nothing
    expect(Number.isFinite(withMatch)).toBe(true);
  });

  it('weights title matches above snippet matches', () => {
    const titleHit = bm25Score('alpha', 'alpha', 'other words');
    const snippetHit = bm25Score('alpha', 'other words', 'alpha');
    expect(titleHit).toBeGreaterThan(snippetHit);
  });

  it('handles an all-empty title+snippet (avgLen fallback)', () => {
    // allTokens.length === 0 → `allTokens.length || 1` right side
    expect(bm25Score('test', '', '')).toBe(0);
  });
});

describe('rankResults', () => {
  it('returns input unchanged for empty results or a stopword-only query', () => {
    expect(rankResults('alpha', [])).toEqual([]);
    const res = [mk({ title: 'alpha doc' })];
    expect(rankResults('the of and', res)).toBe(res);
  });

  it('ranks by corpus-level BM25 and handles empty snippets', () => {
    // snippet '' → `r.snippet || ''` right side (L113)
    const strong = mk({ title: 'alpha alpha alpha', snippet: 'alpha everywhere', domain: 'a.com' });
    const weak = mk({ title: 'alpha once', snippet: '', domain: 'b.com' });
    const unrelated = mk({ title: 'beta gamma', snippet: 'no query terms', domain: 'c.com' });
    const out = rankResults('alpha', [unrelated, strong, weak]);
    expect(out).toEqual([strong, weak, unrelated]);
  });
});

describe('diversifyByDomain', () => {
  it('returns short lists unchanged', () => {
    const res = [mk({ domain: 'a.com' }), mk({ domain: 'b.com' })];
    expect(diversifyByDomain(res, 2)).toBe(res);
  });

  it('caps per domain, relaxes at up to 3×, and groups undefined domains', () => {
    // domain undefined → `|| '__no_domain__'` right side (L211 + L222)
    const items: SearchResult[] = [];
    for (let i = 0; i < 8; i++) items.push(mk({ title: `a${i}`, domain: 'a.com' }));
    for (let i = 0; i < 8; i++) items.push(mk({ title: `b${i}`, domain: 'b.com' }));
    items.push(mk({ title: 'nodef1', domain: undefined }));
    items.push(mk({ title: 'nodef2', domain: undefined }));
    const out = diversifyByDomain(items, 2);
    // initial cap: 2 per domain + all no-domain = 6 (< 20 → relaxation runs);
    // relaxation allows each domain up to 3× = 6 total
    expect(out).toHaveLength(14);
    expect(out.filter(r => r.domain === 'a.com')).toHaveLength(6);
    expect(out.filter(r => r.domain === 'b.com')).toHaveLength(6);
    expect(out.filter(r => r.domain === undefined)).toHaveLength(2);
    // order preserved within the relaxation: the first capped results lead
    expect(out[0].title).toBe('a0');
    expect(out[1].title).toBe('a1');
  });

  it('stops relaxation at the 3× per-domain cap', () => {
    const items = Array.from({ length: 8 }, (_, i) => mk({ title: `x${i}`, domain: 'solo.com' }));
    const out = diversifyByDomain(items, 2);
    // 2 initial + 4 relaxed = 6 (3× maxPerDomain); the rest are dropped
    expect(out).toHaveLength(6);
    expect(out.map(r => r.title)).toEqual(['x0', 'x1', 'x2', 'x3', 'x4', 'x5']);
  });
});

describe('formatResults', () => {
  it('returns the no-results message for an empty list', () => {
    expect(formatResults([])).toBe('No results found.');
  });

  it('formats a bare result without score/viewCount/source/snippet/domain', () => {
    // neither score nor viewCount → stats if-else side (L247 else)
    const line = formatResults([
      mk({ title: 'Bare', url: 'https://bare.example/p', domain: undefined, source: undefined, snippet: '' }),
    ]);
    expect(line).toBe('1. Bare\n   URL: https://bare.example/p');
  });

  it('formats score-only, viewCount-only, and both (stats separators)', () => {
    const out = formatResults([
      mk({ title: 'Score only', score: 1.5 }),
      mk({ title: 'Views only', viewCount: 42 }),
      mk({ title: 'Both', score: 2.5, viewCount: 7 }),
    ]);
    // score-only → viewCount if-else side (L248 if)
    expect(out).toContain('Score: +1.5');
    // viewCount-only → `stats ? ' · ' : ''` false side (no separator)
    expect(out).toContain('42 views');
    // both → ' · ' separator
    expect(out).toContain('Score: +2.5 · 7 views');
    const lines = out.split('\n\n');
    expect(lines[1]).toContain('Views only');
    expect(lines[1]).not.toContain('·');
    // snippet + domain lines still render
    const withExtr = formatResults([mk({ title: 'X', snippet: 'some snippet text', domain: 'x.example' })]);
    expect(withExtr).toContain('some snippet text');
    expect(withExtr).toContain('Domain: x.example');
  });
});
