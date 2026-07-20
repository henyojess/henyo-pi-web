import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchWikipedia } from '../../shared/search/providers';

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

  it('returns empty array on HTTP error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('error', { status: 500 });
    });
    const results = await searchWikipedia('test');
    expect(results).toEqual([]);
  });

  it('returns empty array on malformed JSON', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('not json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchWikipedia('test');
    expect(results).toEqual([]);
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
  it('returns empty array on network error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('Network error');
    });
    const results = await searchWikipedia('test');
    expect(results).toEqual([]);
  });
});