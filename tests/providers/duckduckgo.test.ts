import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchDuckDuckGo } from '../../shared/search/providers';

vi.mock('../../shared/user-agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/user-agents')>();
  return {
    ...actual,
    pickRandom: (arr: string[]) => arr[0],
    delay: () => Promise.resolve(),
  };
});
import {
  DDG_HTML_WITH_RESULTS,
  DDG_HTML_NO_BODY,
  DDG_HTML_NO_RESULTS,
  DDG_HTML_CAPTCHA,
  DDG_HTML_ACCESS_DENIED,
  DDG_HTML_MALFORMED,
  DDG_HTML_WITH_REDIRECT_UDDG,
  DDG_HTML_WITH_RESULT__URL_CLASS,
  DDG_HTML_NO_SNIPPET,
  DDG_HTML_SECOND_ENDPOINT_WORKS,
  DDG_HTML_WITH_ABSTRACT,
} from './shared.test.ts';

describe('searchDuckDuckGo', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('html.duckduckgo.com') || url.includes('duckduckgo.com/html')) {
        return new Response(DDG_HTML_WITH_RESULTS, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      throw new Error('Unexpected fetch: ' + url);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed results from HTML', async () => {
    const results = await searchDuckDuckGo('test query');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('DuckDuckGo Search');
    expect(results[0].url).toBe('https://example.com/page1');
    expect(results[0].snippet).toBe('This is the first result snippet with some details.');
  });

  it('returns empty array when no <body> tag', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_NO_BODY, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });

  it('returns empty array when body contains "No results"', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_NO_RESULTS, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });

  it('returns empty array when all endpoints fail', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('error', { status: 500 });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });

  it('returns empty array on CAPTCHA detection', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_CAPTCHA, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });

  it('returns empty array on access denied', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_ACCESS_DENIED, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });

  it('extracts title from result link', async () => {
    const results = await searchDuckDuckGo('test');
    expect(results[0].title).toBe('DuckDuckGo Search');
    expect(results[0].title).toContain('DuckDuckGo');
  });

  it('extracts redirect URL from uddg= param', async () => {
    const results = await searchDuckDuckGo('test');
    expect(results[0].url).toBe('https://example.com/page1');
  });

  it('extracts redirect URL from /l/? path', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_WITH_REDIRECT_UDDG, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results[0].url).toBe('https://example.com/path');
  });

  it('falls back to result__url class for URL', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_WITH_RESULT__URL_CLASS, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results[0].url).toBe('https://direct-url.com/page');
  });

  it('extracts snippet from result__snippet', async () => {
    const results = await searchDuckDuckGo('test');
    expect(results[0].snippet).toBe('This is the first result snippet with some details.');
  });

  it('inserts "Direct Answer" at top of results', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_WITH_ABSTRACT, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results[0].title).toBe('Direct Answer');
    expect(results[0].snippet).toBe('Direct Answer text here');
  });

  it('handles missing snippet gracefully', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_NO_SNIPPET, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results[0].snippet).toBe('');
  });

  it('handles second endpoint when first fails', async () => {
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('first failed', { status: 500 });
      }
      return new Response(DDG_HTML_SECOND_ENDPOINT_WORKS, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Fallback Result');
  });

  it('handles malformed HTML gracefully', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_MALFORMED, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });

  it('catches network errors in endpoint loop', async () => {
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('DNS lookup failed');
      return new Response(DDG_HTML_SECOND_ENDPOINT_WORKS, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Fallback Result');
  });

  it('extracts URL from /l/? path when uddg param missing', async () => {
    const html = `
      <html><body>
      <div class="result">
        <a class="result__a" href="/l/?foo=bar%26uddg=https%3A%2F%2Fexample.com%2Fpath">Title</a>
        <a class="result__snippet">Snippet</a>
      </div>
      </div>
      </div>
      </body></html>
    `;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results[0].url).toBe('https://example.com/path');
  });
});

describe('DDG CAPTCHA detection', () => {
  it('detects captcha keyword', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('<html><body>captcha detected</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });

  it('detects access denied keyword', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('<html><body>access denied</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });

  it('detects HTTP 429 rate limit', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('Rate limited', { status: 429 });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });
});