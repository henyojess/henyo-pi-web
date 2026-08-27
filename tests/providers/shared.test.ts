import { describe, it, expect, vi } from 'vitest';
import { detectContext, CODING_SIGNALS } from '../../shared/search/context';
import { sanitizeQuery } from '../../shared/search/providers';
import { extractDomain } from '../../shared/search/providers/base';
import { searchNpm, searchGitHub, searchWikipedia, searchStackOverflowAPI } from '../../shared/search/providers';
import { enqueue } from '../../shared/search/queue';
import type { SearchResult } from '../../shared/search/providers/base';

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

export const SO_JINA_HTML_WITH_RESULTS = `
[Test Question Title](https://stackoverflow.com/questions/12345/test-question)
This is a test question description with some details.

[Another Question](https://stackoverflow.com/questions/67890/another-question)
Description of another question here.
`;

export const SO_JINA_HTML_NO_RESULTS = `No stackoverflow links found in this content.`;

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
  ['Programming language', 'Typed superset of JavaScript'],
  ['https://en.wikipedia.org/wiki/JavaScript', 'https://en.wikipedia.org/wiki/TypeScript'],
]);

export const WIKIPEDIA_EXTRACT_RESPONSE = JSON.stringify({
  query: {
    pages: {
      '12345': { extract: 'JavaScript is a high-level programming language.', title: 'JavaScript' },
    },
  },
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

describe('sanitizeQuery', () => {
  it('strips double quotes', () => {
    expect(sanitizeQuery('"xxx" yyy zzz')).toBe('xxx yyy zzz');
  });

  it('strips single quotes', () => {
    expect(sanitizeQuery("it's a test")).toBe('it s a test');
  });

  it('strips parentheses', () => {
    expect(sanitizeQuery('error (TypeError)')).toBe('error TypeError');
  });

  it('strips angle brackets', () => {
    expect(sanitizeQuery('<div> content </div>')).toBe('div content div');
  });

  it('strips colons and semicolons', () => {
    expect(sanitizeQuery('npm install: package;')).toBe('npm install package');
  });

  it('collapses multiple spaces', () => {
    expect(sanitizeQuery('hello    world')).toBe('hello world');
  });

  it('trims leading/trailing whitespace', () => {
    expect(sanitizeQuery('  hello world  ')).toBe('hello world');
  });

  it('preserves alphanumerics, hyphens, underscores, dots, plus', () => {
    expect(sanitizeQuery('my-package_v2.0+build')).toBe('my-package_v2.0+build');
  });

  it('empty after sanitization returns empty string', () => {
    expect(sanitizeQuery('""')).toBe('');
  });

  it('no-op for simple query', () => {
    expect(sanitizeQuery('hello world')).toBe('hello world');
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
    await searchNpm('test', controller.signal);
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
    await searchGitHub('test', controller.signal);
    expect(receivedSignal).toBe(controller.signal);
  });

  it('Wikipedia passes signal to fetch', async () => {
    let receivedSignal: AbortSignal | undefined;
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string, init?: any) => {
      receivedSignal = init?.signal;
      // Batch extract call needs a proper extract response (the opensearch
      // array shape would now surface as a provider error, not be swallowed)
      if (url.includes('action=query')) {
        return new Response(WIKIPEDIA_EXTRACT_RESPONSE, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(WIKIPEDIA_RESPONSE, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const controller = new AbortController();
    await searchWikipedia('test', controller.signal);
    expect(receivedSignal).toBe(controller.signal);
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

describe('enqueue — per-provider serialization', () => {
  it('queues a second concurrent call and resolves FIFO', async () => {
    // delay() is mocked to resolve immediately, so the 2-5s inter-call delay is instant
    const order: number[] = [];
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const name = 'queue-fifo-test-provider';
    const mk = (n: number, title: string): SearchResult => ({ title, url: `https://example.com/${n}`, snippet: 's', domain: 'example.com', source: name });

    const first = enqueue(name, async () => {
      await gate; // hold the provider so the second call must queue
      order.push(1);
      return [mk(1, 'first')];
    });
    // give the first call a tick to start (PROVIDER_RUNNING set) so the
    // second call takes the queued (else) branch
    await new Promise((r) => setTimeout(r, 5));
    const second = enqueue(name, async () => {
      order.push(2);
      return [mk(2, 'second')];
    });

    releaseFirst();
    const [r1, r2] = await Promise.all([first, second]);
    expect(order).toEqual([1, 2]); // serialized: first finished before second started
    expect(r1[0].title).toBe('first');
    expect(r2[0].title).toBe('second');
  });
});