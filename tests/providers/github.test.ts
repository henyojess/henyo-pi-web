import { describe, it, expect, vi } from 'vitest';
import { searchGitHub } from '../../shared/search/providers';
import { rateLimitStore } from '../../shared/rate-limit';
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

// search/issues endpoint shape — one open issue (PR items are filtered by the provider).
// Note: real API items carry no top-level owner/name — the repo must be derived
// from html_url, which is what this fixture exercises.
const GITHUB_ISSUE_RESPONSE = JSON.stringify({
  items: [
    {
      number: 7,
      title: 'React CSS cascade bug',
      state: 'open',
      body: 'Styles load in the wrong order with dynamic imports.',
      html_url: 'https://github.com/facebook/react/issues/7',
      comments: 4,
      reactions: { total_count: 12 },
    },
  ],
});

// URL-aware GitHub Search API mock: repositories → repos, issues → issues
function mockGitHubFetch(repoBody: string, issueBody: string) {
  return vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
    const body = url.includes('/search/issues') ? issueBody : repoBody;
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

describe('searchGitHub', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns results for query', async () => {
    mockGitHubFetch(GITHUB_RESPONSE, JSON.stringify({ items: [] }));
    const results = await searchGitHub('test');
    expect(results.length).toBe(2);
    expect(results[0].title).toBe('facebook/react (JavaScript)');
    expect(results[0].url).toBe('https://github.com/facebook/react');
    expect(results[0].snippet).toBe('A JavaScript library for building user interfaces');
    expect(results[0].source).toBe('github');
  });

  it('merges issue results after repository results', async () => {
    mockGitHubFetch(GITHUB_RESPONSE, GITHUB_ISSUE_RESPONSE);
    const results = await searchGitHub('css cascade');
    expect(results.length).toBe(3); // 2 repos + 1 issue
    expect(results[2].title).toBe('facebook/react#7 [open] — React CSS cascade bug');
    expect(results[2].url).toBe('https://github.com/facebook/react/issues/7');
    expect(results[2].snippet).toContain('4 comments, 12 👍');
    expect(results[2].source).toBe('github');
  });

  it('returns repo results when the issues endpoint fails', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('/search/issues')) return new Response('Not Found', { status: 404 });
      return new Response(GITHUB_RESPONSE, { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const results = await searchGitHub('test');
    expect(results.length).toBe(2);
    expect(results[0].title).toBe('facebook/react (JavaScript)');
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

  it('falls back to unknown/unknown when the issue html_url is not a github owner/name path', async () => {
    // Exercises repoFromHtmlUrl's '' sides: non-github host, a github.com URL with
    // no owner/name path components, and the catch (unparseable URL).
    mockGitHubFetch(
      JSON.stringify({ items: [] }),
      JSON.stringify({
        items: [
          {
            number: 9,
            title: 'Weird host issue',
            state: 'open',
            body: 'b',
            html_url: 'https://gitlab.com/o/r/issues/9',
            comments: 0,
            reactions: { total_count: 0 },
          },
          {
            number: 10,
            title: 'Bare github URL',
            state: 'open',
            body: 'b',
            html_url: 'https://github.com/',
            comments: 0,
            reactions: { total_count: 0 },
          },
          {
            number: 11,
            title: 'Unparseable URL',
            state: 'open',
            body: 'b',
            html_url: 'not-a-url',
            comments: 0,
            reactions: { total_count: 0 },
          },
          {
            number: 12,
            title: 'No body',
            state: 'closed',
            body: '', // empty body → stats-only snippet
            html_url: 'https://github.com/x/y/issues/12',
            comments: 2,
            reactions: { total_count: 3 },
          },
          {
            number: 13,
            title: 'Long body',
            state: 'open',
            body: 'A body that is definitely longer than one hundred and sixty characters so the excerpt truncation with the ellipsis marker gets exercised by the issue mapper in this test.',
            html_url: 'https://github.com/x/z/issues/13',
            comments: 0,
            reactions: { total_count: 0 },
          },
        ],
      }),
    );
    const results = await searchGitHub('weird hosts');
    expect(results.map(r => r.title)).toEqual([
      'unknown/unknown#9 [open] — Weird host issue',
      'unknown/unknown#10 [open] — Bare github URL',
      'unknown/unknown#11 [open] — Unparseable URL',
      'x/y#12 [closed] — No body',
      'x/z#13 [open] — Long body',
    ]);
    // Empty body → no excerpt → snippet is the stats line only
    expect(results[3].snippet).toBe('2 comments, 3 👍');
    // Long body → excerpt truncated at 160 chars with an ellipsis
    expect(results[4].snippet).toContain('…');
  });

  it('already-aborted signal: both endpoints reject, re-throws with aborted trace', async () => {
    const LOG = join(mkdtempSync(join(tmpdir(), 'henyo-trace-test-')), 'trace.log');
    (globalThis as Record<string, unknown>).__henyoTraceLogPath = LOG;
    (globalThis as Record<string, unknown>).__henyoTraceConfig = ['github'];
    try {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Aborted'));
      const controller = new AbortController();
      controller.abort();
      await expect(searchGitHub('aborted query', controller.signal)).rejects.toThrow('Aborted');
      const log = fs.readFileSync(LOG, 'utf8');
      expect(log).toContain('github');
      expect(log).toContain('status="aborted"');
    } finally {
      try { fs.unlinkSync(LOG); } catch { /* no log — fine */ }
      delete (globalThis as Record<string, unknown>).__henyoTraceConfig;
      delete (globalThis as Record<string, unknown>).__henyoTraceLogPath;
    }
  });

  it('aborted with a fulfilled repositories outcome uses the issues rejection reason', async () => {
    // repositories resolves (rejectedReason → undefined) → the ?? falls through to
    // the issues outcome; rejectedReason also takes its fulfilled side here.
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('/search/issues')) {
        throw new Error('Aborted');
      }
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const controller = new AbortController();
    controller.abort();
    await expect(searchGitHub('partial abort', controller.signal)).rejects.toThrow('Aborted');
  });

  it('aborted with non-Error rejection reasons throws the synthesized "Aborted" error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue('boom-string');
    const controller = new AbortController();
    controller.abort();
    await expect(searchGitHub('string abort', controller.signal)).rejects.toThrow('Aborted');
  });

  it('both endpoints fail with non-Error reasons → throws "GitHub API search failed"', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue('boom-string');
    await expect(searchGitHub('double fail')).rejects.toThrow('GitHub API search failed');
  });
});