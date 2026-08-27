import { describe, it, expect, vi } from 'vitest';
import { searchGitHub } from '../../shared/search/providers';
import { rateLimitStore } from '../../shared/rate-limit';

vi.mock('../../shared/user-agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/user-agents')>();
  return {
    ...actual,
    pickRandom: (arr: string[]) => arr[0],
    delay: () => Promise.resolve(),
  };
});

vi.mock('../../shared/rate-limit', () => {
  // In-memory stand-in — keeps 403/429 cooldown side effects off the real disk
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
  return { RateLimitStore, rateLimitStore, DEFAULT_RATE_LIMIT_COOLDOWNS: { github: 300_000 } };
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

  it('throws on HTTP error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('error', { status: 500 });
    });
    await expect(searchGitHub('test')).rejects.toThrow('GitHub API HTTP 500');
  });

  it('throws on 403 and sets the built-in github cooldown', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('rate limited', { status: 403 });
    });
    await expect(searchGitHub('test')).rejects.toThrow('GitHub API HTTP 403');
    expect(rateLimitStore.remainingMs('github')).toBeGreaterThan(0);
  });

  it('throws on malformed JSON', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('not json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await expect(searchGitHub('test')).rejects.toThrow();
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