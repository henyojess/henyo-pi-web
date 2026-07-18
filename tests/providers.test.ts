import {
  searchDuckDuckGo,
  searchStackOverflow,
  searchStackOverflowAPI,
  searchNpm,
  searchGitHub,
  searchWikipedia,
  searchJina,
  searchSearXNG,
  PROVIDER_MAP,
  extractDomain,
} from '../shared/search/providers';
import { detectContext, CODING_SIGNALS } from '../shared/search/context';
import type { SearchResult } from '../shared/search/providers';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

// Mock delay to be instant (mock the module, not global timers)
vi.mock('../shared/user-agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/user-agents')>();
  return {
    ...actual,
    pickRandom: (arr: string[]) => arr[0],
    delay: () => Promise.resolve(),
  };
});

// ─── Fixtures ────────────────────────────────────────────────────────────────
// Note: DDG regex expects `<div class="result...">content</div></div></div>`
// SO regex expects `<div class="s-prose...">content</div></div></div>`

const DDG_HTML_WITH_RESULTS = `
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

const DDG_HTML_WITH_ABSTRACT = `
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

const DDG_HTML_NO_BODY = `<html><head><title>No body</title></head></html>`;
const DDG_HTML_NO_RESULTS = `<html><body>No results found.</body></html>`;
const DDG_HTML_CAPTCHA = `<html><body>Sorry, you have been blocked. captcha detected.</body></html>`;
const DDG_HTML_ACCESS_DENIED = `<html><body>access denied</body></html>`;
const DDG_HTML_MALFORMED = `not even html`;

const DDG_HTML_WITH_REDIRECT_UDDG = `
<html><body>
<div class="result">
  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fpath">Title</a>
  <a class="result__snippet">Snippet</a>
</div>
</div>
</div>
</body></html>
`;

const DDG_HTML_WITH_RESULT__URL_CLASS = `
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

const DDG_HTML_NO_SNIPPET = `
<html><body>
<div class="result">
  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com">Title Only</a>
</div>
</div>
</div>
</body></html>
`;

const DDG_HTML_SECOND_ENDPOINT_WORKS = `
<html><body>
<div class="result">
  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com">Fallback Result</a>
  <a class="result__snippet">From second endpoint</a>
</div>
</div>
</div>
</body></html>
`;

const DDG_HTML_TITLE_WITH_TAGS = `
<html><body>
<div class="result">
  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com"><b>Bold Title</b></a>
  <a class="result__snippet">Snippet</a>
</div>
</div>
</div>
</body></html>
`;

const DDG_HTML_EMPTY_RESULT = `
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
const SO_HTML_WITH_RESULTS = `
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

const SO_HTML_NO_QUESTIONS = `<div class="other">No questions here</div>`;

const SO_HTML_EMPTY_TITLE = `
<div class="s-prose js-post-body">
  <a class="s-link" href="/questions/123">   </a>
  <p class="">Description</p>
</div>
</div>
</div>
`;

const SO_HTML_LONG_TITLE = `
<div class="s-prose js-post-body">
  <a class="s-link" href="/questions/123">${'A'.repeat(300)}</a>
  <p class="">Description</p>
</div>
</div>
</div>
`;

// npm / GitHub
const NPM_RESPONSE = JSON.stringify({
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

const NPM_RESPONSE_NO_OBJECTS = JSON.stringify({ error: 'not found' });

const GITHUB_RESPONSE = JSON.stringify({
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
const WIKIPEDIA_RESPONSE = JSON.stringify([
  null,
  ['JavaScript', 'TypeScript'],
  ['https://en.wikipedia.org/wiki/JavaScript', 'https://en.wikipedia.org/wiki/TypeScript'],
  ['Programming language', 'Typed superset of JavaScript'],
]);

const WIKIPEDIA_EXTRACT_RESPONSE = JSON.stringify({
  query: {
    pages: {
      '12345': { extract: 'JavaScript is a high-level programming language.', title: 'JavaScript' },
    },
  },
});

const JINA_RESPONSE = JSON.stringify({
  results: [
    {
      title: 'Jina Search Result',
      url: 'https://jina.ai/search',
      content: '<p>This is the search result content.</p>',
    },
  ],
});

// ─── Phase 1: DuckDuckGo (~15 tests) ───────────────────────────────────────

describe('searchDuckDuckGo', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('html.duckduckgo.com') || url.includes('duckduckgo.com/html')) {
        return new Response(DDG_HTML_WITH_RESULTS, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      throw new Error('Unexpected fetch: ' + url);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed results from HTML', async () => {
    const results = await searchDuckDuckGo('test query');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('DuckDuckGo Search');
    expect(results[0].url).toBe('https://example.com/page1');
    expect(results[0].snippet).toBe('This is the first result snippet with some details.');
  });

  it('returns empty array when no <body> tag', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_NO_BODY, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });

  it('returns empty array when body contains "No results"', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_NO_RESULTS, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });

  it('returns empty array when all endpoints fail', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('error', { status: 500 });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });

  it('returns empty array on CAPTCHA detection', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_CAPTCHA, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });

  it('returns empty array on access denied', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_ACCESS_DENIED, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });

  it('extracts title from result link', async () => {
    const results = await searchDuckDuckGo('test');
    expect(results[0].title).toBe('DuckDuckGo Search');
    expect(results[0].title).toContain('DuckDuckGo');
  });

  it('extracts redirect URL from uddg= param', async () => {
    const results = await searchDuckDuckGo('test');
    expect(results[0].url).toBe('https://example.com/page1');
  });

  it('extracts redirect URL from /l/? path', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_WITH_REDIRECT_UDDG, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results[0].url).toBe('https://example.com/path');
  });

  it('falls back to result__url class for URL', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_WITH_RESULT__URL_CLASS, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results[0].url).toBe('https://direct-url.com/page');
  });

  it('extracts snippet from result__snippet', async () => {
    const results = await searchDuckDuckGo('test');
    expect(results[0].snippet).toBe('This is the first result snippet with some details.');
  });

  it('inserts "Direct Answer" at top of results', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_WITH_ABSTRACT, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results[0].title).toBe('Direct Answer');
    expect(results[0].snippet).toBe('Direct Answer text here');
  });

  it('handles missing snippet gracefully', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_NO_SNIPPET, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results[0].snippet).toBe('');
  });

  it('handles second endpoint when first fails', async () => {
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('first failed', { status: 500 });
      }
      return new Response(DDG_HTML_SECOND_ENDPOINT_WORKS, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Fallback Result');
  });

  it('handles malformed HTML gracefully', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(DDG_HTML_MALFORMED, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });

  it('catches network errors in endpoint loop', async () => {
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('DNS lookup failed');
      return new Response(DDG_HTML_SECOND_ENDPOINT_WORKS, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Fallback Result');
  });

  it('extracts URL from /l/? path when uddg param missing', async () => {
    const html = `
      <html><body>
      <div class="result">
        <a class="result__a" href="/l/?foo=bar%26uddg=https%3A%2F%2Fexample.com%2Fpath">Title</a>
        <a class="result__snippet">Snippet</a>
      </div>
      </div>
      </div>
      </body></html>
    `;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    // URLSearchParams.get('uddg') returns null (uddg is after &), falls back to /l/? path
    // pathMatch[1] = "foo=bar%26uddg=https%3A%2F%2Fexample.com%2Fpath"
    // split('uddg=')[1] = "https%3A%2F%2Fexample.com%2Fpath"
    expect(results[0].url).toBe('https://example.com/path');
  });
});

// ─── Phase 2: StackOverflow (~6 tests) ──────────────────────────────────────

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

// ─── Phase 3: npm & GitHub API Providers (~8 tests) ─────────────────────────

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

  it('returns empty array on HTTP error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('error', { status: 500 });
    });
    const results = await searchNpm('test');
    expect(results).toEqual([]);
  });

  it('returns empty array on malformed JSON', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('not json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await searchNpm('test');
    expect(results).toEqual([]);
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

// ─── Phase 4: Wikipedia, Jina, SearXNG (~12 tests) ────────────────────────

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
        return new Response(JSON.stringify([null, ['Test'], ['https://en.wikipedia.org/wiki/Test'], ['Desc']]), {
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
        return new Response(JSON.stringify([null, ['Test'], ['https://en.wikipedia.org/wiki/Test'], [null]]), {
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
    const results = await searchSearXNG('https://searx.local', 'test');
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('SearXNG Result');
    expect(results[0].url).toBe('https://example.com');
    expect(results[0].snippet).toBe('SearXNG search content here');
    expect(results[0].source).toBe('searxng');
  });

  it('returns empty array for empty URL', async () => {
    const results = await searchSearXNG('', 'test');
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
    const results = await searchSearXNG('https://searx.local', 'test');
    expect(results[0].title).toBe('Untitled');
    expect(results[0].url).toBe('https://example.com');
  });

  it('catches network errors and returns empty array', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('Network error');
    });
    const results = await searchSearXNG('https://searx.local', 'test');
    expect(results).toEqual([]);
  });

  it('returns empty array on HTTP error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('Internal Server Error', { status: 500 });
    });
    const results = await searchSearXNG('https://searx.local', 'test');
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
    const results = await searchSearXNG('https://searx.local', 'test');
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
    const results = await searchSearXNG('https://searx.local', 'test');
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
    const results = await searchSearXNG('https://searx.local', 'test');
    expect(results[0].url).toBe('');
  });
});

// ─── Phase 5: PROVIDER_MAP (~3 tests) ──────────────────────────────────────

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

// ─── withRetry / CAPTCHA detection tests ─────────────────────────────────────

describe('DDG CAPTCHA detection', () => {
  it('detects captcha keyword', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('<html><body>captcha detected</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });

  it('detects access denied keyword', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('<html><body>access denied</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });

  it('detects HTTP 429 rate limit', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('Rate limited', { status: 429 });
    });
    const results = await searchDuckDuckGo('test');
    expect(results).toEqual([]);
  });
});


// ─── StackOverflow API tests ────────────────────────────────────────────────

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
// ─── extractDomain tests ─────────────────────────────────────────────────────

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

// ─── Phase 6: context.ts supplementary tests (~5 tests) ───────────────────

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

describe('searchSearXNG — edge cases', () => {
  it('returns empty array when !url', async () => {
    const results = await searchSearXNG('query', '');
    expect(results).toEqual([]);
  });

  it('returns empty array when !res.ok', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('Not found', { status: 404 });
    });
    const results = await searchSearXNG('query', 'https://searx.be/search');
    expect(results).toEqual([]);
  });

  it('returns empty array on malformed JSON', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('not json', { status: 200 });
    });
    const results = await searchSearXNG('query', 'https://searx.be/search');
    expect(results).toEqual([]);
  });

  it('returns empty array when network error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('Network error');
    });
    const results = await searchSearXNG('query', 'https://searx.be/search');
    expect(results).toEqual([]);
  });
});

describe('searchNpm — edge cases', () => {
  it('returns empty array on network error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('Network error');
    });
    const results = await searchNpm('test');
    expect(results).toEqual([]);
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

// ─── PROVIDER_MAP ────────────────────────────────────────────────────────────

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