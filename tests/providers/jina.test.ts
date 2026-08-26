import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import { searchJina } from '../../shared/search/providers';

vi.mock('../../shared/user-agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/user-agents')>();
  return {
    ...actual,
    pickRandom: (arr: string[]) => arr[0],
    delay: () => Promise.resolve(),
  };
});
import { JINA_RESPONSE } from './shared.test.ts';

const JINA_TRACE_LOG = '/tmp/jina-trace.log';

function clearJinaTraceLog() {
  try {
    fs.unlinkSync(JINA_TRACE_LOG);
  } catch {
    // no file — fine
  }
}

describe('searchJina', () => {
  afterEach(() => {
    clearJinaTraceLog();
    vi.restoreAllMocks();
  });

  it('returns parsed results', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(JINA_RESPONSE, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchJina('test');
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('Jina Search Result');
    expect(results[0].url).toBe('https://jina.ai/search');
    expect(results[0].snippet).toBe('This is the search result content.');
    expect(results[0].source).toBe('jina-search');
  });

  it('returns empty array on HTTP error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('error', { status: 500 });
    });
    const results = await searchJina('test');
    expect(results).toEqual([]);
  });

  it('returns empty array on malformed JSON', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('not json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchJina('test');
    expect(results).toEqual([]);
  });

  it('handles missing title/url/content fields', async () => {
    const minimalResponse = JSON.stringify({
      results: [{ content: 'just content' }],
    });
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(minimalResponse, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchJina('test');
    expect(results[0].title).toBe('Untitled');
    expect(results[0].url).toBe('');
    expect(results[0].snippet).toBe('just content');
  });

  it('returns empty array when no results key', async () => {
    const noResultsResponse = JSON.stringify({ error: 'no results key' });
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(noResultsResponse, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchJina('test');
    expect(results).toEqual([]);
  });

  it('handles null content field', async () => {
    const nullContentResponse = JSON.stringify({
      results: [{ title: 'Test', url: 'https://example.com', content: null }],
    });
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(nullContentResponse, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchJina('test');
    expect(results[0].snippet).toBe('');
  });

  it('writes trace log lines when __henyoTraceConfig is enabled', async () => {
    clearJinaTraceLog();
    const previous = (globalThis as Record<string, unknown>).__henyoTraceConfig;
    (globalThis as Record<string, unknown>).__henyoTraceConfig = true;
    try {
      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        return new Response(JINA_RESPONSE, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });
      await searchJina('trace me please');
      const content = fs.readFileSync(JINA_TRACE_LOG, 'utf-8');
      expect(content).toContain('Sending search request for: trace me please');
      expect(content).toContain('Response status: 200 ok: true');
      expect(content).toContain('Parsed JSON, results count: 1');
    } finally {
      delete (globalThis as Record<string, unknown>).__henyoTraceConfig;
      if (previous !== undefined) {
        (globalThis as Record<string, unknown>).__henyoTraceConfig = previous;
      }
      clearJinaTraceLog();
    }
  });

  it('aborts the in-flight request when the caller signal aborts (listener wires up + clears timeout)', async () => {
    let fetchInit: { signal?: AbortSignal } | undefined;
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      fetchInit = init as { signal?: AbortSignal };
      // hang until the internal controller aborts, then reject like a real fetch
      return new Promise<Response>((_resolve, reject) => {
        fetchInit?.signal?.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
      });
    });

    const controller = new AbortController();
    const p = searchJina('abort test', controller.signal);
    // let the request start so the abort listener is registered
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    const results = await p;
    // the abort listener fired: internal controller aborted (fetch received the abort)
    expect(fetchInit?.signal?.aborted).toBe(true);
    // catch path → resolves [] (exception traced as a no-op, config unset)
    expect(results).toEqual([]);
  });

  it('aborts via the 20s in-call timeout when no caller signal is given', async () => {
    vi.useFakeTimers();
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      // hangs until the 20s in-call timeout aborts the internal controller
      return new Promise<Response>((_resolve, reject) => {
        (init as { signal?: AbortSignal })?.signal?.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
      });
    });

    const p = searchJina('timeout test');
    await vi.advanceTimersByTimeAsync(21000);
    const results = await p;
    vi.useRealTimers();
    expect(results).toEqual([]);
  });
});