import { describe, it, expect, vi } from 'vitest';
import { searchGitHub } from '../../shared/search/providers';

vi.mock('../../shared/user-agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/user-agents')>();
  return {
    ...actual,
    pickRandom: (arr: string[]) => arr[0],
    delay: () => Promise.resolve(),
  };
});
import { GITHUB_RESPONSE } from './shared.test.ts';

describe('searchGitHub', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns results for query', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(GITHUB_RESPONSE, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchGitHub('test');
    expect(results.length).toBe(2);
    expect(results[0].title).toBe('facebook/react (JavaScript)');
    expect(results[0].url).toBe('https://github.com/facebook/react');
    expect(results[0].snippet).toBe('A JavaScript library for building user interfaces');
    expect(results[0].source).toBe('github');
  });

  it('returns empty array on HTTP error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('error', { status: 500 });
    });
    const results = await searchGitHub('test');
    expect(results).toEqual([]);
  });

  it('returns empty array on malformed JSON', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('not json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchGitHub('test');
    expect(results).toEqual([]);
  });

  it('handles missing description field', async () => {
    const responseNoDesc = JSON.stringify({
      items: [
        {
          owner: { login: 'test' },
          name: 'repo',
          html_url: 'https://github.com/test/repo',
          description: null,
          language: null,
        },
      ],
    });
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(responseNoDesc, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchGitHub('test');
    expect(results[0].snippet).toBe('No description');
  });

  it('returns empty array when no items key', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchGitHub('test');
    expect(results).toEqual([]);
  });
});