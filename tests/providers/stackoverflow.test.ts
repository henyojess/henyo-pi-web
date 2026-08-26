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

  it('rejects when Jina returns non-OK (visible error, not silent [])', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('api.stackexchange.com')) {
        return new Response(JSON.stringify({ items: [], quota_remaining: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('error', { status: 500 });
    });
    await expect(searchStackOverflow('test')).rejects.toThrow('StackOverflow scraper unavailable');
  });

  it('rejects when Jina request fails (fetch rejects) — not resolve []', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('api.stackexchange.com')) {
        return new Response(JSON.stringify({ items: [], quota_remaining: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error('Jina network error');
    });
    await expect(searchStackOverflow('test')).rejects.toThrow('StackOverflow scraper unavailable');
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

  it('throws on API HTTP error (e.g. 429 rate limit)', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('rate limited', { status: 429 });
    });
    await expect(searchStackOverflowAPI('test')).rejects.toThrow('StackOverflow API HTTP 429');
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
    await searchStackOverflowAPI('query', { providers: { stackoverflow: { 'api-key': 'abc123' } } });
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

// ─── Method 2: plain-fetch HTML parsing (parseHtmlResults) ──────────────────

describe('searchStackOverflow method 2 (plain fetch)', () => {
  // API quota exhausted; Jina ok but zero SO links → parser falls through to method 2
  const mockMethod2 = (plainHtml: string, plainStatus = 200, plainThrows = false) => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('api.stackexchange.com')) {
        return new Response(JSON.stringify({ items: [], quota_remaining: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('r.jina.ai')) {
        return new Response(SO_JINA_HTML_NO_RESULTS, {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      if (plainThrows) throw new Error('plain fetch network error');
      return new Response(plainHtml, {
        status: plainStatus,
        headers: { 'Content-Type': 'text/html' },
      });
    });
  };

  it('parses SO question blocks (title/url/snippet) from plain HTML', async () => {
    mockMethod2(SO_HTML_WITH_RESULTS);
    const results = await searchStackOverflow('test');
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Test Question Title');
    expect(results[0].url).toBe('https://stackoverflow.com/questions/12345/test-question');
    expect(results[0].snippet).toContain('test question description');
    expect(results[0].source).toBe('stackoverflow');
    expect(results[0].domain).toBe('stackoverflow.com');
    expect(results[1].title).toBe('Another Question');
    expect(results[1].url).toBe('https://stackoverflow.com/questions/67890/another-question');
  });

  it('returns [] when plain HTML contains no question blocks', async () => {
    mockMethod2(SO_HTML_NO_QUESTIONS);
    const results = await searchStackOverflow('test');
    expect(results).toEqual([]);
  });

  it('returns [] when the plain fetch response is not ok', async () => {
    mockMethod2(SO_HTML_WITH_RESULTS, 503);
    const results = await searchStackOverflow('test');
    expect(results).toEqual([]);
  });

  it('returns [] when the plain fetch throws', async () => {
    mockMethod2(SO_HTML_WITH_RESULTS, 200, true);
    const results = await searchStackOverflow('test');
    expect(results).toEqual([]);
  });

  it('skips question blocks with empty titles', async () => {
    mockMethod2(SO_HTML_EMPTY_TITLE);
    const results = await searchStackOverflow('test');
    expect(results).toEqual([]);
  });

  it('truncates long plain-HTML titles to 200 chars', async () => {
    mockMethod2(SO_HTML_LONG_TITLE);
    const results = await searchStackOverflow('test');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('A'.repeat(200));
  });

  it('caps results at 10 and dedupes repeated links', async () => {
    const block = (id: number) => `<div class="s-prose js-post-body">
  <a class="s-link" href="/questions/${id}/slug">Question ${id}</a>
  <p class="">Snippet for question ${id}.</p>
</div>
</div>
</div>`;
    // 10 unique blocks: first href repeated (dedup hit), one block without an
    // s-link (missing-link continue), then enough unique blocks to hit the 10-cap
    const noLinkBlock = `<div class="s-prose js-post-body">
  <p class="">Prose without a question link.</p>
</div>
</div>
</div>`;
    const html = [block(1000), block(1000), noLinkBlock, ...Array.from({ length: 10 }, (_, i) => block(1002 + i))].join('\n');
    mockMethod2(html);
    const results = await searchStackOverflow('test');
    expect(results).toHaveLength(10); // capped; deduped + linkless blocks excluded
    const urls = results.map((r) => r.url);
    expect(new Set(urls).size).toBe(10); // no duplicates
  });
});

// ─── Jina branch behavior (parseJinaHtml) ────────────────────────────────────

describe('searchStackOverflow jina branches', () => {
  const mockJinaText = (text: string) => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('api.stackexchange.com')) {
        return new Response(JSON.stringify({ items: [], quota_remaining: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(text, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    });
  };

  it('applies SO-only filter, relative-URL normalization, dedup and 200-char trim', async () => {
    const text = [
      '[Not SO](https://example.com/q1)', // skipped: non-SO link
      '[   ](/questions/999)', // skipped: empty title
      '[Rel Link](/questions/111/rel?src=stackoverflow.com)', // relative → normalized (query keeps it past the SO filter)
      '[Dup](https://stackoverflow.com/questions/222/dup)', // kept
      '[Dup Query](https://stackoverflow.com/questions/222/dup?tab=answers)', // skipped: dedup after ? split
      `[Long ${'L'.repeat(300)}](https://stackoverflow.com/questions/333/long)`, // title trimmed to 200
    ].join('\n');
    mockJinaText(text);
    const results = await searchStackOverflow('test');
    // kept: Rel Link (normalized), Dup, Long title (trimmed to 200)
    expect(results).toHaveLength(3);
    expect(results[0].title).toBe('Rel Link');
    expect(results[0].url).toBe('https://stackoverflow.com/questions/111/rel');
    expect(results[1].title).toBe('Dup');
    expect(results[1].url).toBe('https://stackoverflow.com/questions/222/dup');
    expect(results[2].title.length).toBe(200);
    expect(results[2].title.startsWith('Long L')).toBe(true);
    expect(results[2].url).toBe('https://stackoverflow.com/questions/333/long');
  });

  it('caps jina results at 10', async () => {
    const text = Array.from({ length: 12 }, (_, i) => `[Q${i}](https://stackoverflow.com/questions/${1000 + i}/q${i})`).join('\n');
    mockJinaText(text);
    const results = await searchStackOverflow('test');
    expect(results).toHaveLength(10);
  });
});

// ─── Abort signal ────────────────────────────────────────────────────────────

describe('searchStackOverflow abort signal', () => {
  it('completes without hanging when the caller signal is already aborted (method 2 reached)', async () => {
    // Fake timers so method 2's un-cleared 15s abort-timeout (registered on an
    // already-aborted signal, so the abort listener never fires) can't hold the worker open.
    vi.useFakeTimers();
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('api.stackexchange.com')) {
        return new Response(JSON.stringify({ items: [], quota_remaining: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('r.jina.ai')) {
        // ok but zero SO links → scraper proceeds to method 2 with the (aborted) signal
        return new Response(SO_JINA_HTML_NO_RESULTS, { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
      return new Response(SO_HTML_WITH_RESULTS, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });

    const controller = new AbortController();
    controller.abort(); // pre-aborted: exercises the addEventListener wiring on an aborted signal
    const results = await searchStackOverflow('test', controller.signal);
    vi.useRealTimers();
    // Completed (no hang): method 2 ran against the mock and returned parsed results
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Test Question Title');
  });

  it('aborts the in-flight method-2 fetch when the caller signal aborts mid-flight', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string, init?: { signal?: AbortSignal }) => {
      if (url.includes('api.stackexchange.com')) {
        return new Response(JSON.stringify({ items: [], quota_remaining: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('r.jina.ai')) {
        return new Response(SO_JINA_HTML_NO_RESULTS, { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
      // plain fetch hangs until aborted, then rejects like a real fetch would
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
      });
    });

    const controller = new AbortController();
    const p = searchStackOverflow('test', controller.signal);
    // let the API + Jina calls settle so method 2 registers its abort listener
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    const results = await p;
    expect(results).toEqual([]);
  });

  it('aborts the method-2 fetch after the 15s in-call timeout elapses', async () => {
    vi.useFakeTimers();
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string, init?: { signal?: AbortSignal }) => {
      if (url.includes('api.stackexchange.com')) {
        return new Response(JSON.stringify({ items: [], quota_remaining: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('r.jina.ai')) {
        return new Response(SO_JINA_HTML_NO_RESULTS, { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
      // hangs until the internal 15s timeout aborts the controller
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
      });
    });

    const p = searchStackOverflow('test');
    // 16s > 15s in-call timeout → the setTimeout callback aborts the internal controller
    await vi.advanceTimersByTimeAsync(16000);
    const results = await p;
    vi.useRealTimers();
    expect(results).toEqual([]);
  });
});
