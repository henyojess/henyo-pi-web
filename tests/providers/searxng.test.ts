import { describe, it, expect, vi } from 'vitest';
import { searchSearXNG } from '../../shared/search/providers';

vi.mock('../../shared/user-agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/user-agents')>();
  return {
    ...actual,
    pickRandom: (arr: string[]) => arr[0],
    delay: () => Promise.resolve(),
  };
});

describe('searchSearXNG', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed results', async () => {
    const searxngResponse = JSON.stringify({
      results: [
        {
          title: 'SearXNG Result',
          url: 'https://example.com',
          content: 'SearXNG search content here',
        },
      ],
    });
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(searxngResponse, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchSearXNG('test', { url: 'https://searx.local' });
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('SearXNG Result');
    expect(results[0].url).toBe('https://example.com');
    expect(results[0].snippet).toBe('SearXNG search content here');
    expect(results[0].source).toBe('searxng');
  });

  it('returns empty array for empty URL', async () => {
    const results = await searchSearXNG('test', { url: '' });
    expect(results).toEqual([]);
  });

  it('handles missing fields gracefully', async () => {
    const minimalResponse = JSON.stringify({
      results: [
        {
          url: 'https://example.com',
          content: 'No title here',
        },
      ],
    });
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(minimalResponse, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchSearXNG('test', { url: 'https://searx.local' });
    expect(results[0].title).toBe('Untitled');
    expect(results[0].url).toBe('https://example.com');
  });

  it('catches network errors and returns empty array', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('Network error');
    });
    const results = await searchSearXNG('test', { url: 'https://searx.local' });
    expect(results).toEqual([]);
  });

  it('returns empty array on HTTP error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('Internal Server Error', { status: 500 });
    });
    const results = await searchSearXNG('test', { url: 'https://searx.local' });
    expect(results).toEqual([]);
  });

  it('returns empty array when no results key', async () => {
    const noResultsResponse = JSON.stringify({
      error: 'no results key',
    });
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(noResultsResponse, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchSearXNG('test', { url: 'https://searx.local' });
    expect(results).toEqual([]);
  });

  it('handles null content field', async () => {
    const nullContentResponse = JSON.stringify({
      results: [
        {
          title: 'Test',
          url: 'https://example.com',
          content: null,
        },
      ],
    });
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(nullContentResponse, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchSearXNG('test', { url: 'https://searx.local' });
    expect(results[0].snippet).toBe('');
  });

  it('handles empty url field in result', async () => {
    const emptyUrlResponse = JSON.stringify({
      results: [
        {
          title: 'Test',
          content: 'Some content',
        },
      ],
    });
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(emptyUrlResponse, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchSearXNG('test', { url: 'https://searx.local' });
    expect(results[0].url).toBe('');
  });
});

describe('searchSearXNG — edge cases', () => {
  it('returns empty array when !url', async () => {
    const results = await searchSearXNG('query', { url: '' });
    expect(results).toEqual([]);
  });

  it('returns empty array when !res.ok', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('Not found', { status: 404 });
    });
    const results = await searchSearXNG('query', { url: 'https://searx.be/search' });
    expect(results).toEqual([]);
  });

  it('returns empty array on malformed JSON', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('not json', { status: 200 });
    });
    const results = await searchSearXNG('query', { url: 'https://searx.be/search' });
    expect(results).toEqual([]);
  });

  it('returns empty array when network error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('Network error');
    });
    const results = await searchSearXNG('query', { url: 'https://searx.be/search' });
    expect(results).toEqual([]);
  });
});