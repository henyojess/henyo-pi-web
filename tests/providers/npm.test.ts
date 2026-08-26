import { describe, it, expect, vi } from 'vitest';
import { searchNpm } from '../../shared/search/providers';

vi.mock('../../shared/user-agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/user-agents')>();
  return {
    ...actual,
    pickRandom: (arr: string[]) => arr[0],
    delay: () => Promise.resolve(),
  };
});
import { NPM_RESPONSE, NPM_RESPONSE_NO_OBJECTS } from './shared.test.ts';

describe('searchNpm', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns results for known package', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(NPM_RESPONSE, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchNpm('test');
    expect(results.length).toBe(2);
    expect(results[0].title).toBe('vitest@1.0.0');
    expect(results[0].url).toBe('https://www.npmjs.com/package/vitest');
    expect(results[0].snippet).toBe('Next generation testing framework');
    expect(results[0].source).toBe('npm');
  });

  it('throws on HTTP error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('error', { status: 500 });
    });
    await expect(searchNpm('test')).rejects.toThrow('npm registry HTTP 500');
  });

  it('throws on 404 (no matches is a different thing)', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('not found', { status: 404 });
    });
    await expect(searchNpm('test')).rejects.toThrow('npm registry HTTP 404');
  });

  it('throws on malformed JSON', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('not json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await expect(searchNpm('test')).rejects.toThrow();
  });

  it('returns empty array when no objects key', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(NPM_RESPONSE_NO_OBJECTS, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchNpm('test');
    expect(results).toEqual([]);
  });

  it('handles package with no description', async () => {
    const noDescResponse = JSON.stringify({
      objects: [
        { package: { name: 'test-pkg', version: '1.0.0', description: null } },
      ],
    });
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(noDescResponse, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchNpm('test');
    expect(results[0].snippet).toBe('');
  });
});

describe('searchNpm — edge cases', () => {
  it('throws on network error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('Network error');
    });
    await expect(searchNpm('test')).rejects.toThrow('Network error');
  });
});