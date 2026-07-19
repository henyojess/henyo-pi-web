import { describe, it, expect, vi } from 'vitest';
import { detectContext, CODING_SIGNALS } from '../../shared/search/context';
import { PROVIDER_MAP } from '../../shared/search/providers';
import { extractDomain } from '../../shared/search/providers/base';
import { searchNpm, searchGitHub, searchWikipedia, searchSearXNG, searchJina, searchStackOverflowAPI } from '../../shared/search/providers';

vi.mock('../../shared/user-agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/user-agents')>();
  return {
    ...actual,
    pickRandom: (arr: string[]) => arr[0],
    delay: () => Promise.resolve(),
  };
});
// Fixtures are defined below in this file

// ─── Shared Fixtures ─────────────────────────────────────────────────────────

// Note: DDG regex expects `<div class="result...">content</div></div></div>`
// SO regex expects `<div class="s-prose...">content</div></div></div>`

export const DDG_HTML_WITH_RESULTS = `
<html><body>
<div class="result">
  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1">DuckDuckGo Search</a>
  <a class="result__snippet">This is the first result snippet with some details.</a>
</div>
</div>
</div>
<div class="result">
  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fpage2">Second Result</a>
  <a class="result__snippet">Another snippet here.</a>
</div>
</div>
</div>
</body></html>
`;

export const DDG_HTML_WITH_ABSTRACT = `
<html><body>
<div class="result">
  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com">Title</a>
  <a class="result__snippet">Snippet</a>
</div>
</div>
</div>
<a class="abstract" href="https://example.com/answer">Direct Answer text here</a>
</body></html>
`;

export const DDG_HTML_NO_BODY = `<html><head><title>No body</title></head></html>`;
export const DDG_HTML_NO_RESULTS = `<html><body>No results found.</body></html>`;
export const DDG_HTML_CAPTCHA = `<html><body>Sorry, you have been blocked. captcha detected.</body></html>`;
export const DDG_HTML_ACCESS_DENIED = `<html><body>access denied</body></html>`;
export const DDG_HTML_MALFORMED = `not even html`;

export const DDG_HTML_WITH_REDIRECT_UDDG = `
<html><body>
<div class="result">
  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fpath">Title</a>
  <a class="result__snippet">Snippet</a>
</div>
</div>
</div>
</body></html>
`;

export const DDG_HTML_WITH_RESULT__URL_CLASS = `
<html><body>
<div class="result">
  <a class="result__a" href="#">Title</a>
  <a class="result__url">https://direct-url.com/page</a>
  <a class="result__snippet">Snippet text</a>
</div>
</div>
</div>
</body></html>
`;

export const DDG_HTML_NO_SNIPPET = `
<html><body>
<div class="result">
  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com">Title Only</a>
</div>
</div>
</div>
</body></html>
`;

export const DDG_HTML_SECOND_ENDPOINT_WORKS = `
<html><body>
<div class="result">
  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com">Fallback Result</a>
  <a class="result__snippet">From second endpoint</a>
</div>
</div>
</div>
</body></html>
`;

export const DDG_HTML_TITLE_WITH_TAGS = `
<html><body>
<div class="result">
  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com"><b>Bold Title</b></a>
  <a class="result__snippet">Snippet</a>
</div>
</div>
</div>
</body></html>
`;

export const DDG_HTML_EMPTY_RESULT = `
<html><body>
<div class="result">
  <a class="result__a" href="#">   </a>
  <a class="result__snippet"></a>
</div>
</div>
</div>
</body></html>
`;

// StackOverflow fixtures
export const SO_HTML_WITH_RESULTS = `
<div class="s-prose js-post-body">
  <a class="s-link" href="/questions/12345/test-question">Test Question Title</a>
  <p class="">This is a test question description.</p>
</div>
</div>
</div>
<div class="s-prose js-post-body">
  <a class="s-link" href="/questions/67890/another-question">Another Question</a>
  <p class="">Description of another question.</p>
</div>
</div>
</div>
`;

export const SO_HTML_NO_QUESTIONS = `<div class="other">No questions here</div>`;

export const SO_HTML_EMPTY_TITLE = `
<div class="s-prose js-post-body">
  <a class="s-link" href="/questions/123">   </a>
  <p class="">Description</p>
</div>
</div>
</div>
`;

export const SO_HTML_LONG_TITLE = `
<div class="s-prose js-post-body">
  <a class="s-link" href="/questions/123">${'A'.repeat(300)}</a>
  <p class="">Description</p>
</div>
</div>
</div>
`;

// npm / GitHub
export const NPM_RESPONSE = JSON.stringify({
  objects: [
    {
      package: {
        name: 'vitest',
        version: '1.0.0',
        description: 'Next generation testing framework',
      },
    },
    {
      package: {
        name: 'jest',
        version: '29.0.0',
        description: 'Delightful JavaScript Testing',
      },
    },
  ],
});

export const NPM_RESPONSE_NO_OBJECTS = JSON.stringify({ error: 'not found' });

export const GITHUB_RESPONSE = JSON.stringify({
  items: [
    {
      owner: { login: 'facebook' },
      name: 'react',
      html_url: 'https://github.com/facebook/react',
      description: 'A JavaScript library for building user interfaces',
      language: 'JavaScript',
    },
    {
      owner: { login: 'google' },
      name: 'tensorflow',
      html_url: 'https://github.com/tensorflow/tensorflow',
      description: null,
      language: 'C++',
    },
  ],
});

// Wikipedia response is an ARRAY (actual API format), not an object
export const WIKIPEDIA_RESPONSE = JSON.stringify([
  null,
  ['JavaScript', 'TypeScript'],
  ['https://en.wikipedia.org/wiki/JavaScript', 'https://en.wikipedia.org/wiki/TypeScript'],
  ['Programming language', 'Typed superset of JavaScript'],
]);

export const WIKIPEDIA_EXTRACT_RESPONSE = JSON.stringify({
  query: {
    pages: {
      '12345': { extract: 'JavaScript is a high-level programming language.', title: 'JavaScript' },
    },
  },
});

export const JINA_RESPONSE = JSON.stringify({
  results: [
    {
      title: 'Jina Search Result',
      url: 'https://jina.ai/search',
      content: '<p>This is the search result content.</p>',
    },
  ],
});

// ─── Shared Tests ────────────────────────────────────────────────────────────

describe('detectContext edge cases', () => {
  it('empty string → general', () => {
    expect(detectContext('')).toBe('general');
  });

  it('single signal → general', () => {
    expect(detectContext('const x = 5')).toBe('general');
  });

  it('exactly 2 signals → coding', () => {
    expect(detectContext('const async function')).toBe('coding');
  });

  it('many signals (>10) → coding', () => {
    expect(detectContext('const async await import def class npm install pip install cargo install')).toBe('coding');
  });

  it('all signal patterns tested', () => {
    expect(Array.isArray(CODING_SIGNALS)).toBe(true);
    expect(CODING_SIGNALS.length).toBeGreaterThan(0);
    for (const signal of CODING_SIGNALS) {
      expect(signal instanceof RegExp).toBe(true);
    }
  });
});

describe('extractDomain', () => {
  it('extracts domain from https URL', () => {
    expect(extractDomain('https://example.com/path')).toBe('example.com');
  });

  it('extracts domain from http URL', () => {
    expect(extractDomain('http://test.org')).toBe('test.org');
  });

  it('returns undefined for invalid URL', () => {
    expect(extractDomain('not-a-url')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractDomain('')).toBeUndefined();
  });
});

describe('PROVIDER_MAP', () => {
  it('has all 7 expected provider keys', () => {
    expect(PROVIDER_MAP).toHaveProperty('duckduckgo');
    expect(PROVIDER_MAP).toHaveProperty('stackoverflow');
    expect(PROVIDER_MAP).toHaveProperty('npm');
    expect(PROVIDER_MAP).toHaveProperty('github');
    expect(PROVIDER_MAP).toHaveProperty('wikipedia');
    expect(PROVIDER_MAP).toHaveProperty('jina');
    expect(PROVIDER_MAP).toHaveProperty('searxng');
  });

  it('all values are functions', () => {
    for (const [key, fn] of Object.entries(PROVIDER_MAP)) {
      expect(typeof fn).toBe('function');
    }
  });

  it('unknown key returns undefined', () => {
    expect(PROVIDER_MAP['unknown']).toBeUndefined();
  });
});

describe('AbortSignal propagation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('npm passes signal to fetch', async () => {
    let receivedSignal: AbortSignal | undefined;
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string, init?: any) => {
      receivedSignal = init?.signal;
      return new Response(NPM_RESPONSE, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const controller = new AbortController();
    await searchNpm('test', undefined, controller.signal);
    expect(receivedSignal).toBe(controller.signal);
  });

  it('GitHub passes signal to fetch', async () => {
    let receivedSignal: AbortSignal | undefined;
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string, init?: any) => {
      receivedSignal = init?.signal;
      return new Response(GITHUB_RESPONSE, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const controller = new AbortController();
    await searchGitHub('test', undefined, controller.signal);
    expect(receivedSignal).toBe(controller.signal);
  });

  it('Wikipedia passes signal to fetch', async () => {
    let receivedSignal: AbortSignal | undefined;
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string, init?: any) => {
      receivedSignal = init?.signal;
      return new Response(WIKIPEDIA_RESPONSE, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const controller = new AbortController();
    await searchWikipedia('test', undefined, controller.signal);
    expect(receivedSignal).toBe(controller.signal);
  });

  it('SearXNG accepts signal parameter without error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const controller = new AbortController();
    // Should not throw — signal is connected to internal controller
    const results = await searchSearXNG('test', { url: 'https://searx.local' }, controller.signal);
    expect(results).toEqual([]);
  });

  it('Jina accepts signal parameter without error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(JINA_RESPONSE, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const controller = new AbortController();
    // Should not throw — signal is connected to internal controller
    const results = await searchJina('test', undefined, controller.signal);
    expect(results.length).toBeGreaterThan(0);
  });

  it('StackOverflow API passes signal to fetch', async () => {
    let receivedSignal: AbortSignal | undefined;
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string, init?: any) => {
      receivedSignal = init?.signal;
      return new Response(JSON.stringify({ items: [], quota_remaining: 100 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const controller = new AbortController();
    await searchStackOverflowAPI('test', undefined, controller.signal);
    expect(receivedSignal).toBe(controller.signal);
  });
});