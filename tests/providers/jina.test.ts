import { describe, it, expect, vi } from 'vitest';
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

describe('searchJina', () => {
  afterEach(() => {
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
});