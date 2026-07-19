import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchStackOverflow, searchStackOverflowAPI } from '../../shared/search/providers';

vi.mock('../../shared/user-agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/user-agents')>();
  return {
    ...actual,
    pickRandom: (arr: string[]) => arr[0],
    delay: () => Promise.resolve(),
  };
});
import { SO_HTML_WITH_RESULTS, SO_HTML_NO_QUESTIONS, SO_HTML_EMPTY_TITLE, SO_HTML_LONG_TITLE } from './shared.test.ts';

describe('searchStackOverflow', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(SO_HTML_WITH_RESULTS, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed results from HTML', async () => {
    const results = await searchStackOverflow('test');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Test Question Title');
    expect(results[0].url).toBe('https://stackoverflow.com/questions/12345/test-question');
    expect(results[0].source).toBe('stackoverflow');
  });

  it('returns empty array when no questions found', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(SO_HTML_NO_QUESTIONS, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchStackOverflow('test');
    expect(results).toEqual([]);
  });

  it('returns empty array on non-OK response', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
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
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(SO_HTML_LONG_TITLE, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchStackOverflow('test');
    expect(results[0].title.length).toBe(200);
  });

  it('skips entries with empty titles', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(SO_HTML_EMPTY_TITLE, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchStackOverflow('test');
    expect(results).toEqual([]);
  });
});

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
});