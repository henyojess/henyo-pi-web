import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { searchDuckDuckGo } from '../../shared/search/providers';

vi.mock('../../shared/user-agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/user-agents')>();
  return {
    ...actual,
    pickRandom: (arr: string[]) => arr[0],
    delay: () => Promise.resolve(),
  };
});

vi.mock('../../shared/rate-limit', () => {
  // In-memory stand-in — keeps 429/CAPTCHA cooldown side effects off the real disk
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

  it('throws when all endpoints fail', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('error', { status: 500 });
    });
    await expect(searchDuckDuckGo('test')).rejects.toThrow('No endpoint succeeded');
  });

  it('throws on CAPTCHA detection (cooldown already set)', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_CAPTCHA, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    await expect(searchDuckDuckGo('test')).rejects.toThrow('CAPTCHA');
  });

  it('throws on access denied (cooldown already set)', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_ACCESS_DENIED, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    await expect(searchDuckDuckGo('test')).rejects.toThrow('CAPTCHA');
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
    await expect(searchDuckDuckGo('test')).rejects.toThrow('CAPTCHA');
  });

  it('detects access denied keyword', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('<html><body>access denied</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    await expect(searchDuckDuckGo('test')).rejects.toThrow('CAPTCHA');
  });

  it('detects HTTP 429 rate limit', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('Rate limited', { status: 429 });
    });
    await expect(searchDuckDuckGo('test')).rejects.toThrow('RATE_LIMITED');
  });
});

describe('searchDuckDuckGo — abort signal & trace', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__henyoTraceConfig;
    try {
      fs.unlinkSync('/tmp/henyo-trace.log');
    } catch {
      // no file — fine
    }
    vi.restoreAllMocks();
  });

  it('aborts the in-flight endpoint fetch when the caller signal aborts mid-call', async () => {
    // Endpoint 1 → 503 (continue to endpoint 2); endpoint 2 hangs until the
    // internal controller aborts, like a real slow fetch would.
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string, init?: { signal?: AbortSignal }) => {
      const u = String(url);
      if (u.includes('html.duckduckgo.com')) {
        return new Response('unavailable', { status: 503 });
      }
      if (u.includes('duckduckgo.com/html')) {
        return new Promise<Response>((_resolve, reject) => {
          const sig = init?.signal;
          if (!sig) throw new Error('expected abort signal in fetch init');
          if (sig.aborted) return reject(new Error('AbortError'));
          sig.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
        });
      }
      throw new Error('Unexpected fetch: ' + u);
    });

    const controller = new AbortController();
    const p = searchDuckDuckGo('test', controller.signal);
    // let endpoint 1 (503) be consumed and the abort listener registered
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    // withRetry (delay mocked → immediate) exhausts retries, provider rethrows
    await expect(p).rejects.toThrow('AbortError');
  });

  it('writes a trace log line when __henyoTraceConfig is enabled', async () => {
    (globalThis as Record<string, unknown>).__henyoTraceConfig = true;
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(DDG_HTML_WITH_RESULTS, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    const results = await searchDuckDuckGo('trace ddg query');
    expect(results.length).toBeGreaterThan(0);
    const content = fs.readFileSync('/tmp/henyo-trace.log', 'utf-8');
    expect(content).toContain('trace ddg query');
    expect(content).toContain('status="ok"');
  });

  it('traces a 429 rate-limit as status="error" error="http-429"', async () => {
    (globalThis as Record<string, unknown>).__henyoTraceConfig = true;
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response('Rate limited', { status: 429 }),
    );
    await expect(searchDuckDuckGo('rate limited query')).rejects.toThrow('RATE_LIMITED');
    const content = fs.readFileSync('/tmp/henyo-trace.log', 'utf-8');
    expect(content).toContain('status="error"');
    expect(content).toContain('error="http-429"');
  });

  it('traces CAPTCHA detection as status="error" error="captcha"', async () => {
    (globalThis as Record<string, unknown>).__henyoTraceConfig = true;
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(DDG_HTML_CAPTCHA, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    await expect(searchDuckDuckGo('captcha query')).rejects.toThrow('CAPTCHA');
    const content = fs.readFileSync('/tmp/henyo-trace.log', 'utf-8');
    expect(content).toContain('status="error"');
    expect(content).toContain('error="captcha"');
  });
});

describe('searchDuckDuckGo — parse fallbacks + internal timeout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ddgResponse = (html: string) =>
    new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });

  it('falls back to result__url when /l/? path has no uddg= segment', async () => {
    const html = `
      <html><body>
      <div class="result">
        <a class="result__a" href="/l/?rut=abc">Path Fallback</a>
        <a class="result__url">https://path-fallback.example/doc</a>
        <a class="result__snippet">Snippet</a>
      </div>
      </div>
      </div>
      </body></html>
    `;
    vi.spyOn(global, 'fetch').mockImplementation(async () => ddgResponse(html));
    const results = await searchDuckDuckGo('test');
    // /l/? matches but contains no uddg= → pathMatch extraction collapses to ''
    // → actualUrl falls back to the result__url text
    expect(results[0].url).toBe('https://path-fallback.example/doc');
  });

  it('emits an Untitled result when the div has no result__a at all', async () => {
    const html = `
      <html><body>
      <div class="result">
        <a class="result__url">https://no-anchor.example/x</a>
        <a class="result__snippet">Only a URL</a>
      </div>
      </div>
      </div>
      </body></html>
    `;
    vi.spyOn(global, 'fetch').mockImplementation(async () => ddgResponse(html));
    const results = await searchDuckDuckGo('test');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Untitled');
    expect(results[0].url).toBe('https://no-anchor.example/x');
  });

  it('skips the result entirely when neither title nor URL can be extracted', async () => {
    const html = `
      <html><body>
      <div class="result">
        <span>unrelated markup only</span>
      </div>
      </div>
      </div>
      </body></html>
    `;
    vi.spyOn(global, 'fetch').mockImplementation(async () => ddgResponse(html));
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });

  it('pushes an empty url when the href is only whitespace', async () => {
    const html = `
      <html><body>
      <div class="result">
        <a class="result__a" href="   ">Spaced</a>
        <a class="result__snippet">Snippet</a>
      </div>
      </div>
      </div>
      </body></html>
    `;
    vi.spyOn(global, 'fetch').mockImplementation(async () => ddgResponse(html));
    const results = await searchDuckDuckGo('test');
    expect(results[0].title).toBe('Spaced');
    // title present, redirectUrl trims to '' and no result__url → url collapses to ''
    expect(results[0].url).toBe('');
  });

  it('does not unshift a Direct Answer when the abstract text collapses to empty', async () => {
    const html = `
      <html><body>
      <div class="result">
        <a class="result__a" href="uddg=https://example.com/normal">Normal</a>
        <a class="result__snippet">Snippet</a>
      </div>
      </div>
      </div>
      <a class="abstract">   <b>  </b>  </a>
      </body></html>
    `;
    vi.spyOn(global, 'fetch').mockImplementation(async () => ddgResponse(html));
    const results = await searchDuckDuckGo('test');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Normal');
  });

  it('rethrows No endpoint succeeded when both endpoints return non-429 errors', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (String(url).includes('html.duckduckgo.com')) return new Response('e1', { status: 500 });
      return new Response('e2', { status: 503 });
    });
    await expect(searchDuckDuckGo('test')).rejects.toThrow('No endpoint succeeded');
  });

  it('keeps looping endpoints when a 200 response has an empty body', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (String(url).includes('html.duckduckgo.com')) {
        return new Response('', { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      return new Response('e2', { status: 500 });
    });
    await expect(searchDuckDuckGo('test')).rejects.toThrow('No endpoint succeeded');
  });

  it('traces a non-Error rejection via String(err)', async () => {
    const LOG = join(mkdtempSync(join(tmpdir(), 'henyo-ddg-')), 'trace.log');
    (globalThis as Record<string, unknown>).__henyoTraceLogPath = LOG;
    (globalThis as Record<string, unknown>).__henyoTraceConfig = ['duckduckgo'];
    try {
      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        throw 'fetch string failure';
      });
      await expect(searchDuckDuckGo('test')).rejects.toEqual('fetch string failure');
      const log = fs.readFileSync(LOG, 'utf-8');
      expect(log).toContain('error="fetch string failure"');
    } finally {
      try { fs.unlinkSync(LOG); } catch { /* no log — fine */ }
      delete (globalThis as Record<string, unknown>).__henyoTraceConfig;
      delete (globalThis as Record<string, unknown>).__henyoTraceLogPath;
    }
  });

  it('aborts internally after 15 s (fake timers) when the endpoint hangs', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(global, 'fetch').mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
        const sig = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          if (!sig || sig.aborted) {
            reject(new Error('AbortError'));
            return;
          }
          sig.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
        });
      });
      // Settle the rejection immediately (handler attached before the
      // advanceTimers calls) — otherwise the rejection lands mid-advance
      // with no handler yet and is reported as an unhandled rejection.
      const p = searchDuckDuckGo('slow query');
      const settled = (async () => {
        try {
          await p;
          return null;
        } catch (e: unknown) {
          return e;
        }
      })();
      // attempt 1 hangs until the 15 s internal timer fires and aborts the
      // controller; attempts 2–3 then reject immediately (already aborted)
      // and the mocked delay resolves instantly
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.advanceTimersByTimeAsync(0);
      const err = await settled;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('AbortError');
    } finally {
      vi.useRealTimers();
    }
  });
});