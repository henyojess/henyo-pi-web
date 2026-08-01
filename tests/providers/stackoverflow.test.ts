import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchStackOverflow, searchStackOverflowAPI, StackOverflowAPIError } from '../../shared/search/providers';

vi.mock('../../shared/user-agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/user-agents')>();
  return {
    ...actual,
    pickRandom: (arr: string[]) => arr[0],
    delay: () => Promise.resolve(),
  };
});
import {
  SO_HTML_WITH_RESULTS,
  SO_HTML_NO_QUESTIONS,
  SO_HTML_EMPTY_TITLE,
  SO_HTML_LONG_TITLE,
  SO_JINA_HTML_WITH_RESULTS,
  SO_JINA_HTML_NO_RESULTS,
} from './shared.test.ts';

// ─── searchStackOverflow (scraper tests) ─────────────────────────────────────

describe('searchStackOverflow', () => {
  beforeEach(() => {
    // Default: API fails, scraper (Jina) succeeds
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('api.stackexchange.com')) {
        return new Response(JSON.stringify({ items: [], quota_remaining: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Jina Reader fallback
      return new Response(SO_JINA_HTML_WITH_RESULTS, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed results from Jina HTML', async () => {
    const results = await searchStackOverflow('test');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Test Question Title');
    expect(results[0].url).toBe('https://stackoverflow.com/questions/12345/test-question');
    expect(results[0].source).toBe('stackoverflow');
  });

  it('returns empty array when no questions found', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('api.stackexchange.com')) {
        return new Response(JSON.stringify({ items: [], quota_remaining: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(SO_JINA_HTML_NO_RESULTS, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    });
    const results = await searchStackOverflow('test');
    expect(results).toEqual([]);
  });

  it('returns empty array on non-OK response', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('api.stackexchange.com')) {
        return new Response(JSON.stringify({ items: [], quota_remaining: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('error', { status: 500 });
    });
    const results = await searchStackOverflow('test');
    expect(results).toEqual([]);
  });

  it('normalizes relative URLs to absolute', async () => {
    const results = await searchStackOverflow('test');
    expect(results[0].url).toBe('https://stackoverflow.com/questions/12345/test-question');
  });

  it('truncates title to 200 chars', async () => {
    vi.resetAllMocks();
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('api.stackexchange.com')) {
        return new Response(JSON.stringify({ items: [], quota_remaining: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(`[${'A'.repeat(300)}](https://stackoverflow.com/questions/123)`, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    });
    const results = await searchStackOverflow('test');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title.length).toBe(200);
  });

  it('skips entries with empty titles', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('api.stackexchange.com')) {
        return new Response(JSON.stringify({ items: [], quota_remaining: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Jina format with empty title
      return new Response(`[   ](https://stackoverflow.com/questions/123)`, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    });
    const results = await searchStackOverflow('test');
    expect(results).toEqual([]);
  });

  it('searchStackOverflow falls back to scraper when API fails', async () => {
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      callCount++;
      if (url.includes('api.stackexchange.com')) {
        return new Response(JSON.stringify({ items: [], quota_remaining: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Jina fallback succeeds
      return new Response(SO_JINA_HTML_WITH_RESULTS, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    });
    const results = await searchStackOverflow('test');
    expect(results.length).toBeGreaterThan(0);
    expect(callCount).toBeGreaterThanOrEqual(2); // API call + Jina call
  });

  it('searchStackOverflow scraper populates domain field', async () => {
    const results = await searchStackOverflow('test');
    expect(results[0].domain).toBe('stackoverflow.com');
  });
});

// ─── searchStackOverflowAPI ──────────────────────────────────────────────────

describe('searchStackOverflowAPI', () => {
  it('returns results for known package', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({
        items: [{
          question_id: 12345,
          title: 'Test Question',
          body: '<p>This is a <b>test</b> body</p>',
          link: 'https://stackoverflow.com/questions/12345',
        }],
        quota_remaining: 100,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchStackOverflowAPI('test query');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Test Question');
    expect(results[0].domain).toBe('stackoverflow.com');
  });

  it('strips HTML tags except code', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({
        items: [{
          question_id: 1,
          title: 'Test',
          body: '<p>Hello <b>world</b> <code>code</code> here</p>',
          link: 'https://stackoverflow.com/questions/1',
        }],
        quota_remaining: 100,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchStackOverflowAPI('test');
    expect(results[0].snippet).toContain('world');
    expect(results[0].snippet).toContain('code');
  });

  it('throws on quota exhaustion', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({
        items: [],
        quota_remaining: 0,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await expect(searchStackOverflowAPI('test')).rejects.toThrow('StackOverflow API rate limited');
  });

  it('includes intitle parameter in API URL', async () => {
    let capturedUrl = '';
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ items: [], quota_remaining: 100 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await searchStackOverflowAPI('test query');
    expect(capturedUrl).toContain('intitle=test+query');
  });

  it('includes all required API parameters', async () => {
    let capturedUrl = '';
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ items: [], quota_remaining: 100 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await searchStackOverflowAPI('test query');
    expect(capturedUrl).toContain('site=stackoverflow');
    expect(capturedUrl).toContain('order=desc');
    expect(capturedUrl).toContain('sort=relevance');
    expect(capturedUrl).toContain('filter=withbody');
    expect(capturedUrl).toContain('pagesize=10');
  });

  it('includes apiKey when provided', async () => {
    let capturedUrl = '';
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ items: [], quota_remaining: 100 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await searchStackOverflowAPI('query', { apiKey: 'abc123' });
    expect(capturedUrl).toContain('key=abc123');
  });

  it('does not include apiKey when not provided', async () => {
    let capturedUrl = '';
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ items: [], quota_remaining: 100 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await searchStackOverflowAPI('query');
    expect(capturedUrl).not.toContain('key=');
  });

  it('StackOverflowAPIError has correct name and message', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({
        items: [],
        quota_remaining: 0,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    try {
      await searchStackOverflowAPI('test');
    } catch (err) {
      expect(err).toBeInstanceOf(StackOverflowAPIError);
      expect((err as StackOverflowAPIError).name).toBe('StackOverflowAPIError');
      expect((err as StackOverflowAPIError).message).toBe('StackOverflow API rate limited');
      expect((err as StackOverflowAPIError).quotaRemaining).toBe(0);
    }
  });
});
