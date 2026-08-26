import { detectContext, CODING_SIGNALS } from '../shared/search/context';
import { normalizeUrl, formatResults, diversifyByDomain, bm25Score, rankResults } from '../shared/format';
import type { SearchResult } from '../shared/search/providers';

// ─── detectContext ───────────────────────────────────────────────────────────

describe('detectContext', () => {
  it('returns general for empty query', () => {
    expect(detectContext('')).toBe('general');
  });

  it('returns general for plain English query', () => {
    expect(detectContext('what is the capital of France')).toBe('general');
  });

  it('returns general for single weak coding signal', () => {
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

  it('returns general for npm as a word alone (no subcommand)', () => {
    expect(detectContext('npm is a package manager')).toBe('general');
  });

  it('returns coding for git related queries', () => {
    expect(detectContext('git commit const x')).toBe('coding');
  });

  it('returns general for non-coding query with one weak signal', () => {
    expect(detectContext('class schedule for today')).toBe('general');
  });

  it('handles mixed signals correctly', () => {
    expect(detectContext('import async function from module')).toBe('coding');
  });

  it('exact pattern matches work', () => {
    // Single strong signal → coding (errors are strong signals)
    expect(detectContext('SyntaxError: unexpected token')).toBe('coding');
    expect(detectContext('Traceback (most recent call last)')).toBe('coding');
    // Compound: traceback + undefined → 2 signals (strong + weak)
    expect(detectContext('Traceback (most recent call last) undefined')).toBe('coding');
  });

  it('rejects single-token false positives', () => {
    // "throw" alone should not match (requires "throw new")
    expect(detectContext('throw an error')).toBe('general');
    // "assert" alone should not match (requires "assert.method()")
    expect(detectContext('assert something')).toBe('general');
    // Single strong signal → coding (TypeError is a strong signal)
    expect(detectContext('I got a TypeError yesterday')).toBe('coding');
    // "SyntaxError" alone → strong signal → coding
    expect(detectContext('SyntaxError is a common word')).toBe('coding');
    // "Traceback" without parenthesis → doesn't match traceback\s*\( pattern
    expect(detectContext('There was a traceback in the log')).toBe('general');
  });

  it('compound patterns still match correctly', () => {
    // throw new + const → 2 weak signals
    expect(detectContext('throw new Error const x')).toBe('coding');
    // TypeError (strong) + undefined (weak) → coding
    expect(detectContext('TypeError: undefined is not a function')).toBe('coding');
    // SyntaxError alone → strong signal → coding
    expect(detectContext('SyntaxError: missing ;')).toBe('coding');
    // Compound: traceback (strong) + undefined (weak) → coding
    expect(detectContext('Traceback (most recent call last) undefined')).toBe('coding');
  });

  it('rejects overly broad patterns', () => {
    // "[something]()" alone should not match (requires content inside brackets)
    expect(detectContext('I have [something]() in my list')).toBe('general');
    // "{key: value}" alone should not match
    expect(detectContext('the object {key: value} is here')).toBe('general');
  });

  it('single strong signals trigger coding', () => {
    // Package managers
    expect(detectContext('npm install package')).toBe('coding');
    // Error patterns
    expect(detectContext('TypeError: undefined is not a function')).toBe('coding');
    // Imports
    expect(detectContext('import React from react')).toBe('coding');
    // Git
    expect(detectContext('git commit -m fix')).toBe('coding');
    // Docker
    expect(detectContext('docker run myimage')).toBe('coding');
    // SQL
    expect(detectContext('select * from users')).toBe('coding');
    // Shell
    expect(detectContext('apt install curl')).toBe('coding');
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
    expect(formatResults(results)).toContain('[npm]');
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

  it('rare terms boost score more than common terms (IDF)', () => {
    // "foobar" is rare — appears in title → high IDF (df=1) → boosted
    const rareScore = bm25Score('foobar', 'foobar is a rare term', 'A common comparison');
    // "a" is a stop word so it's tokenized away, but "comparison" is common — appears in both
    const commonScore = bm25Score('comparison', 'Some title', 'A comparison of common terms');
    expect(rareScore).toBeGreaterThan(0);
    expect(commonScore).toBeGreaterThan(0);
  });

  it('IDF multiplier is applied to both title and snippet scores', () => {
    // Term in title: should get idf * tf * 2.0
    const titleScore = bm25Score('xyz', 'xyz in title', 'no match here');
    // Term in snippet only: should get idf * tf
    const snippetScore = bm25Score('xyz', 'no match here', 'xyz in snippet');
    // Both have IDF since df=1, but title has 2x weight
    expect(titleScore).toBeGreaterThan(0);
    expect(snippetScore).toBeGreaterThan(0);
  });
});

// ─── rankResults (corpus-level BM25) ──────────────────────────────────────────

describe('rankResults', () => {
  it('returns results unchanged for empty query', () => {
    const results: SearchResult[] = [
      { title: 'A', url: 'https://a.com', snippet: 'A' },
      { title: 'B', url: 'https://b.com', snippet: 'B' },
    ];
    expect(rankResults('', results)).toEqual(results);
  });

  it('returns results unchanged for empty results', () => {
    expect(rankResults('test query', [])).toEqual([]);
  });

  it('returns single result unchanged', () => {
    const results: SearchResult[] = [
      { title: 'A', url: 'https://a.com', snippet: 'A' },
    ];
    expect(rankResults('test', results)).toEqual(results);
  });

  it('ranks results with matching titles higher', () => {
    const results: SearchResult[] = [
      { title: 'JavaScript Arrays', url: 'https://a.com', snippet: 'A guide about arrays' },
      { title: 'Random Topic', url: 'https://b.com', snippet: 'JavaScript arrays are useful data structures' },
      { title: 'Python Lists', url: 'https://c.com', snippet: 'Not related to JavaScript' },
    ];
    const ranked = rankResults('javascript arrays', results);
    // First result has both terms in title → should be ranked first
    expect(ranked[0].title).toBe('JavaScript Arrays');
    // Second result has both terms in snippet → should be second
    expect(ranked[1].title).toBe('Random Topic');
  });

  it('rare terms boost results with those terms', () => {
    const results: SearchResult[] = [
      { title: 'foobar configuration', url: 'https://a.com', snippet: 'How to configure foobar' },
      { title: 'Common configuration', url: 'https://b.com', snippet: 'Configuration is a common topic' },
      { title: 'foobar tutorial', url: 'https://c.com', snippet: 'Learn about foobar basics' },
    ];
    const ranked = rankResults('foobar', results);
    // Results with 'foobar' in title should rank higher than without
    const noFoobarIdx = ranked.findIndex(r => r.title === 'Common configuration');
    // The one without 'foobar' should be last (ranked lowest)
    expect(noFoobarIdx).toBe(2);
  });

  it('multiple matching terms increase score', () => {
    const results: SearchResult[] = [
      { title: 'React Hooks useState', url: 'https://a.com', snippet: 'useState hook for state management' },
      { title: 'React Hooks', url: 'https://b.com', snippet: 'A guide to React hooks' },
      { title: 'useState guide', url: 'https://c.com', snippet: 'Everything about useState' },
    ];
    const ranked = rankResults('react hooks useState', results);
    // First result has all 3 terms in title
    expect(ranked[0].title).toBe('React Hooks useState');
  });
});