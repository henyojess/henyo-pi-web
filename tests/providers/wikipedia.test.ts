import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchWikipedia } from '../../shared/search/providers';
import fs, { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../shared/user-agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/user-agents')>();
  return {
    ...actual,
    pickRandom: (arr: string[]) => arr[0],
    delay: () => Promise.resolve(),
  };
});
import { WIKIPEDIA_RESPONSE, WIKIPEDIA_EXTRACT_RESPONSE } from './shared.test.ts';

describe('searchWikipedia', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('action=opensearch')) {
        return new Response(WIKIPEDIA_RESPONSE, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(WIKIPEDIA_EXTRACT_RESPONSE, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed results', async () => {
    const results = await searchWikipedia('test');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('JavaScript');
    expect(results[0].source).toBe('wikipedia');
  });

  it('throws on HTTP error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('error', { status: 500 });
    });
    await expect(searchWikipedia('test')).rejects.toThrow('Wikipedia API HTTP 500');
  });

  it('throws on malformed JSON', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('not json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await expect(searchWikipedia('test')).rejects.toThrow();
  });

  it('falls back to descriptions when no extract', async () => {
    const noExtractResponse = JSON.stringify({
      query: {
        pages: { '12345': { title: 'JavaScript' } },
      },
    });
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('action=opensearch')) {
        return new Response(WIKIPEDIA_RESPONSE, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(noExtractResponse, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchWikipedia('test');
    expect(results[0].snippet).toBe('Programming language');
  });

  it('falls back to descriptions when batch API fails', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('action=opensearch')) {
        return new Response(JSON.stringify([null, ['Test'], ['Desc'], ['https://en.wikipedia.org/wiki/Test']]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Batch API fails
      return new Response('error', { status: 500 });
    });
    const results = await searchWikipedia('test');
    expect(results.length).toBe(1);
    expect(results[0].snippet).toBe('Desc');
  });

  it('handles missing titles array', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify([null, null, null, null]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchWikipedia('test');
    expect(results).toEqual([]);
  });

  it('uses empty string when both extract and description are missing', async () => {
    const noExtractResponse = JSON.stringify({
      query: { pages: { '12345': { title: 'Test' } } },
    });
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('action=opensearch')) {
        return new Response(JSON.stringify([null, ['Test'], [null], ['https://en.wikipedia.org/wiki/Test']]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(noExtractResponse, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchWikipedia('test');
    expect(results[0].snippet).toBe('');
  });
});

describe('searchWikipedia — edge cases', () => {
  it('throws on network error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('Network error');
    });
    await expect(searchWikipedia('test')).rejects.toThrow('Network error');
  });

  it('non-aborted failure re-throws and writes an error trace with the original message', async () => {
    const LOG = join(mkdtempSync(join(tmpdir(), 'henyo-trace-test-')), 'trace.log');
    (globalThis as Record<string, unknown>).__henyoTraceLogPath = LOG;
    (globalThis as Record<string, unknown>).__henyoTraceConfig = ['wikipedia'];
    try {
      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        throw new Error('wiki network boom');
      });
      await expect(searchWikipedia('test')).rejects.toThrow('wiki network boom');
      const log = fs.readFileSync(LOG, 'utf8');
      expect(log).toContain('wikipedia');
      expect(log).toContain('status="error"');
      expect(log).toContain('error="wiki network boom"');
    } finally {
      try { fs.unlinkSync(LOG); } catch { /* no log — fine */ }
      delete (globalThis as Record<string, unknown>).__henyoTraceConfig;
      delete (globalThis as Record<string, unknown>).__henyoTraceLogPath;
    }
  });

  it('batch API failure with short descriptions/urls uses empty fallback strings', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('action=opensearch')) {
        return new Response(JSON.stringify(['q', ['Alpha', 'Beta'], [], []]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('error', { status: 404 });
    });
    const results = await searchWikipedia('q');
    expect(results).toHaveLength(2);
    expect(results.map(r => r.url)).toEqual(['', '']);
    expect(results.map(r => r.snippet)).toEqual(['', '']);
  });

  it('no matching page with missing urls/descriptions uses empty strings', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('action=opensearch')) {
        return new Response(JSON.stringify(['q', ['Alpha'], [], []]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ query: { pages: {} } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchWikipedia('q');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Alpha');
    expect(results[0].url).toBe('');
    expect(results[0].snippet).toBe('');
  });

  it('long extracts are truncated with "..." and pages without extracts fall back to descriptions', async () => {
    const longExtract = 'x'.repeat(350);
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('action=opensearch')) {
        return new Response(JSON.stringify(['q', ['Alpha', 'Beta'], ['Alpha description', 'Beta description'], []]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        query: {
          pages: {
            '1': { title: 'Alpha', extract: longExtract },
            '2': { title: 'Beta' }, // no extract field
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchWikipedia('q');
    expect(results[0].snippet).toBe('x'.repeat(300) + '...');
    expect(results[1].snippet).toBe('Beta description');
    expect(results.map(r => r.url)).toEqual(['', '']);
  });

  it('non-Error failure (string rejection) is traced via String(err) and re-thrown as-is', async () => {
    const LOG = join(mkdtempSync(join(tmpdir(), 'henyo-trace-test-')), 'trace.log');
    (globalThis as Record<string, unknown>).__henyoTraceLogPath = LOG;
    (globalThis as Record<string, unknown>).__henyoTraceConfig = ['wikipedia'];
    try {
      vi.spyOn(global, 'fetch').mockRejectedValue('wiki string failure');
      await expect(searchWikipedia('test')).rejects.toEqual('wiki string failure');
      const log = fs.readFileSync(LOG, 'utf8');
      expect(log).toContain('status="error"');
      expect(log).toContain('error="wiki string failure"');
    } finally {
      try { fs.unlinkSync(LOG); } catch { /* no log — fine */ }
      delete (globalThis as Record<string, unknown>).__henyoTraceConfig;
      delete (globalThis as Record<string, unknown>).__henyoTraceLogPath;
    }
  });
});